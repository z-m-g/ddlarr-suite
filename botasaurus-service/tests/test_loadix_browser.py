"""Browser-side Loadix helpers, driven with a fake driver and a fake clock."""
import pytest


class FakeClock:
    def __init__(self):
        self.now = 1000.0

    def time(self):
        return self.now

    def sleep(self, seconds):
        self.now += seconds


class FakeDriver:
    """Minimal stand-in for the botasaurus Driver: records navigation and injected scripts."""

    def __init__(self, state_provider):
        self.state_provider = state_provider
        self.urls = []
        self.scripts = []

    def get(self, url):
        self.urls.append(url)

    def wait_for_element(self, selector, wait=0):
        pass

    def save_screenshot(self, path):
        pass

    def run_js(self, script):
        self.scripts.append(script)
        if script.startswith('return window.__lxTs'):
            return self.state_provider()
        return None


@pytest.fixture
def browser_env(main_module, monkeypatch):
    clock = FakeClock()
    monkeypatch.setattr(main_module, 'time', clock)
    monkeypatch.setattr(main_module, 'random_delay', lambda *a, **k: None)
    monkeypatch.setattr(main_module, 'fetch_loadix_turnstile_site_key', lambda: '0xTESTKEY')
    clicks = []
    monkeypatch.setattr(main_module, 'click_turnstile_checkbox', lambda driver, prefix='': clicks.append(prefix))
    return clock, clicks


def test_turnstile_token_without_interaction(main_module, browser_env):
    clock, clicks = browser_env
    states = iter([{'status': 'init'}, {'status': 'rendered'}, {'status': 'ok', 'token': 'tok-123'}])
    driver = FakeDriver(lambda: next(states))

    token = main_module._loadix_turnstile_token(driver, action='link_reveal')

    assert token == 'tok-123'
    assert driver.urls == ['https://loadix.fun/auth/login']
    assert '"0xTESTKEY", "link_reveal"' in driver.scripts[0]
    assert clicks == []


def test_turnstile_token_after_clicking_the_checkbox(main_module, browser_env):
    clock, clicks = browser_env
    state = {'status': 'rendered', 'token': None}

    def provider():
        # The widget only yields a token once the checkbox has been clicked
        if clicks:
            return {'status': 'ok', 'token': 'tok-after-click'}
        return state

    driver = FakeDriver(provider)
    token = main_module._loadix_turnstile_token(driver)

    assert token == 'tok-after-click'
    assert clicks == ['[Loadix]']
    assert clock.now - 1000.0 >= 4  # the click only comes after the widget had a chance to pass silently


def test_turnstile_token_retries_the_click_then_gives_up(main_module, browser_env):
    clock, clicks = browser_env
    driver = FakeDriver(lambda: {'status': 'rendered', 'token': None, 'error': None})

    with pytest.raises(main_module.LoadixLoginError) as exc:
        main_module._loadix_turnstile_token(driver)

    assert exc.value.code == 'turnstile_timeout'
    assert len(clicks) == main_module.LOADIX_TURNSTILE_CLICK_ATTEMPTS
    assert clock.now - 1000.0 >= main_module.LOADIX_TURNSTILE_TIMEOUT


def test_click_turnstile_checkbox_uses_the_visual_box(main_module, monkeypatch):
    calls = []

    class FakeElement:
        def __init__(self, name):
            self.name = name

        def get_element_at_point(self, x, y):
            calls.append(('iframe.point', x, y))
            return FakeElement('checkbox')

        def click(self):
            calls.append(('click', self.name))

    class Driver:
        def get_element_at_point(self, x, y):
            calls.append(('driver.point', x, y))
            return FakeElement('iframe')

        def enable_human_mode(self):
            calls.append(('human', True))

        def disable_human_mode(self):
            calls.append(('human', False))

    # box at (100, 200), 300x60, scale 1:1
    monkeypatch.setattr(main_module, 'find_turnstile_box', lambda driver: (100, 200, 300, 60, 1.0, 1.0))
    main_module.click_turnstile_checkbox(Driver(), '[Test]')
    assert calls == [('driver.point', 250, 230), ('iframe.point', 22, 30), ('human', True), ('click', 'checkbox'), ('human', False)]

    monkeypatch.setattr(main_module, 'find_turnstile_box', lambda driver: None)
    with pytest.raises(Exception, match='locate Turnstile'):
        main_module.click_turnstile_checkbox(Driver())


def test_site_key_is_read_from_the_bundle(main_module, monkeypatch):
    class Resp:
        def __init__(self, text):
            self.text = text

    pages = {
        'https://loadix.fun/': Resp('<html><script type="module" src="/assets/index-abc.js"></script></html>'),
        'https://loadix.fun/assets/index-abc.js': Resp('VITE_TURNSTILE_SITE_KEY:sT().min(1)...VITE_TURNSTILE_SITE_KEY:`0xBUNDLEKEY123`'),
    }
    monkeypatch.setattr(main_module.requests, 'get', lambda url, **kw: pages[url])
    monkeypatch.setitem(main_module._loadix_site_key_cache, 'key', None)
    assert main_module.fetch_loadix_turnstile_site_key() == '0xBUNDLEKEY123'

    # Cached afterwards, no request
    monkeypatch.setattr(main_module.requests, 'get', lambda url, **kw: (_ for _ in ()).throw(AssertionError('no request expected')))
    assert main_module.fetch_loadix_turnstile_site_key() == '0xBUNDLEKEY123'


def test_site_key_falls_back_to_the_known_key(main_module, monkeypatch):
    def failing_get(url, **kw):
        raise RuntimeError('offline')

    monkeypatch.setattr(main_module.requests, 'get', failing_get)
    monkeypatch.setitem(main_module._loadix_site_key_cache, 'key', None)
    assert main_module.fetch_loadix_turnstile_site_key() == main_module.LOADIX_TURNSTILE_SITE_KEY


def test_login_creates_the_account_when_the_api_asks_for_a_username(main_module, monkeypatch):
    monkeypatch.setattr(main_module, 'LOADIX_MNEMONIC', 'abandon ' * 11 + 'about')
    monkeypatch.setattr(main_module, 'LOADIX_USERNAME', 'ddlarr')
    tokens = iter(['tok-1', 'tok-2'])
    monkeypatch.setattr(main_module, 'loadix_turnstile_token', lambda action=None: next(tokens))
    attempts = []

    def fake_login(token, username=None):
        attempts.append((token, username))
        if username is None:
            raise main_module.LoadixLoginError('login refused (username_required)', 'username_required')
        return {'accessToken': 'jwt', 'refreshCookie': 'loadix_refresh=x', 'method': 'bip39', 'user': {'username': username}}

    monkeypatch.setattr(main_module, '_loadix_login_with_token', fake_login)
    result = main_module.loadix_login()
    assert result['user'] == {'username': 'ddlarr'}
    assert attempts == [('tok-1', None), ('tok-2', 'ddlarr')]


def test_login_explains_the_missing_username(main_module, monkeypatch):
    monkeypatch.setattr(main_module, 'LOADIX_MNEMONIC', 'abandon ' * 11 + 'about')
    monkeypatch.setattr(main_module, 'LOADIX_USERNAME', '')
    monkeypatch.setattr(main_module, 'loadix_turnstile_token', lambda action=None: 'tok')

    def refuse(token, username=None):
        raise main_module.LoadixLoginError('login refused (username_required)', 'username_required')

    monkeypatch.setattr(main_module, '_loadix_login_with_token', refuse)
    with pytest.raises(main_module.LoadixLoginError, match='LOADIX_USERNAME'):
        main_module.loadix_login()
