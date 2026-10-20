import hashlib

import pytest
from ecdsa import SECP256k1, VerifyingKey
from ecdsa.util import sigdecode_string

# Reference BIP39 vector (English wordlist, empty passphrase)
MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'
SEED_HEX = ('5eb00bbddcf069084889a8ab9155568165f5c453ccb85e70811aaed6f6da5fc1'
            '9a5ac40b389cd370d086206dec8aa6c43daea6690f20ad3d8d48b2d2ce9e38e4')
# Compressed public key of seed[:32], as computed by @noble/curves (the library the Loadix frontend uses)
PUBKEY_HEX = '029058af2e7b6f0dc54d96925b80868515bf87f3158e95afce81927b3b772d5b24'
CHALLENGE = '00' * 31 + '01'
# Signature produced by @noble/curves secp256k1.sign(challenge, priv, {prehash: false}) for the same inputs
NOBLE_SIGNATURE = ('9c1c9c768a8b4eb1ec59e348fccd1c1a5ba05807c1032fe814bd88d190f009d2'
                   '19b033756044c2a5c61a4eaaa42dc9b3c04f95e325a229ba99645270965adcb2')


def test_bip39_seed_matches_reference_vector(main_module):
    assert main_module.bip39_seed(MNEMONIC).hex() == SEED_HEX


def test_normalize_mnemonic_matches_frontend(main_module):
    assert main_module.normalize_mnemonic('  Abandon   ABANDON\nabout ') == 'abandon abandon about'


def test_bip39_signature_matches_noble(main_module):
    pubkey, signature = main_module.bip39_sign_challenge(MNEMONIC, CHALLENGE.upper())
    assert pubkey == PUBKEY_HEX
    assert signature == NOBLE_SIGNATURE


def test_bip39_signature_is_low_s_and_verifies(main_module):
    challenge = hashlib.sha256(b'loadix').hexdigest()
    pubkey, signature = main_module.bip39_sign_challenge(MNEMONIC, challenge)
    assert len(signature) == 128
    s = int(signature[64:], 16)
    assert s <= SECP256k1.order // 2
    vk = VerifyingKey.from_string(bytes.fromhex(pubkey), curve=SECP256k1)
    assert vk.verify_digest(bytes.fromhex(signature), bytes.fromhex(challenge), sigdecode=sigdecode_string)


def test_bip39_rejects_bad_challenge(main_module):
    with pytest.raises(main_module.LoadixLoginError) as exc:
        main_module.bip39_sign_challenge(MNEMONIC, 'not-hex')
    assert exc.value.code == 'invalid_challenge'


def test_login_method_depends_on_configured_credentials(main_module, monkeypatch):
    monkeypatch.setattr(main_module, 'LOADIX_MNEMONIC', '')
    monkeypatch.setattr(main_module, 'LOADIX_EMAIL', '')
    monkeypatch.setattr(main_module, 'LOADIX_PASSWORD', '')
    assert main_module.loadix_login_method() is None
    monkeypatch.setattr(main_module, 'LOADIX_EMAIL', 'a@b.c')
    assert main_module.loadix_login_method() is None  # password missing
    monkeypatch.setattr(main_module, 'LOADIX_PASSWORD', 'secret')
    assert main_module.loadix_login_method() == 'email'
    monkeypatch.setattr(main_module, 'LOADIX_MNEMONIC', MNEMONIC)
    assert main_module.loadix_login_method() == 'bip39'


def test_turnstile_overlay_script_embeds_parameters(main_module):
    script = main_module.LOADIX_TURNSTILE_OVERLAY_JS.replace('__SITE_KEY__', '"0xKEY"').replace('__ACTION__', 'null')
    assert '})("0xKEY", null);' in script
    assert 'challenges.cloudflare.com/turnstile/v0/api.js' in script


def test_status_route_reports_configuration(client, main_module, monkeypatch):
    monkeypatch.setattr(main_module, 'LOADIX_MNEMONIC', '')
    monkeypatch.setattr(main_module, 'LOADIX_EMAIL', '')
    body = client.get('/loadix/status').get_json()
    assert body['configured'] is False and body['method'] is None
    monkeypatch.setattr(main_module, 'LOADIX_MNEMONIC', MNEMONIC)
    assert client.get('/loadix/status').get_json()['method'] == 'bip39'


def test_login_route_without_credentials_is_503(client, main_module, monkeypatch):
    monkeypatch.setattr(main_module, 'LOADIX_MNEMONIC', '')
    monkeypatch.setattr(main_module, 'LOADIX_EMAIL', '')
    response = client.post('/loadix/login')
    assert response.status_code == 503
    assert response.get_json()['code'] == 'not_configured'


def test_login_route_reports_browser_failures(client, main_module, monkeypatch):
    monkeypatch.setattr(main_module, 'LOADIX_MNEMONIC', MNEMONIC)
    monkeypatch.setattr(main_module, 'browser_task', lambda task: {'error': 'no token', 'code': 'turnstile_timeout'})
    response = client.post('/loadix/login')
    assert response.status_code == 502
    assert response.get_json() == {'error': 'no token', 'code': 'turnstile_timeout'}


def test_turnstile_route_passes_the_action(client, main_module, monkeypatch):
    seen = {}

    def fake_task(task):
        seen.update(task)
        return {'token': 'tok'}

    monkeypatch.setattr(main_module, 'browser_task', fake_task)
    response = client.post('/loadix/turnstile', json={'action': 'link_reveal'})
    assert response.get_json() == {'token': 'tok'}
    assert seen == {'task': 'loadix_turnstile', 'action': 'link_reveal'}


def test_login_with_token_handles_api_refusal(main_module, monkeypatch):
    monkeypatch.setattr(main_module, 'LOADIX_MNEMONIC', MNEMONIC)
    posted = []

    class FakeResponse:
        def __init__(self, status_code):
            self.status_code = status_code

    # Same contract as _loadix_post: (response, parsed json)
    def fake_post(session, path, payload):
        posted.append((path, payload))
        if path.endswith('/challenge'):
            return FakeResponse(200), {'challenge': CHALLENGE}
        return FakeResponse(403), {'code': 'turnstile_failed'}

    monkeypatch.setattr(main_module, '_loadix_post', fake_post)
    with pytest.raises(main_module.LoadixLoginError) as exc:
        main_module._loadix_login_with_token('dummy')
    assert exc.value.code == 'turnstile_failed'
    assert posted[1][0] == '/api/auth/bip39/login'
    assert posted[1][1]['pubkey'] == PUBKEY_HEX
    assert posted[1][1]['signature'] == NOBLE_SIGNATURE
    assert posted[1][1]['turnstileToken'] == 'dummy'
