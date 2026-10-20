def test_is_dlprotect_link_matches_any_tld(main_module):
    assert main_module.is_dlprotect_link('https://dl-protect.link/abc') is True
    assert main_module.is_dlprotect_link('https://www.dl-protect.xyz/abc') is True
    assert main_module.is_dlprotect_link('https://1fichier.com/?abc') is False
    assert main_module.is_dlprotect_link('garbage') is False


def test_cache_key_ignores_query_string(main_module):
    assert main_module.get_url_hash('https://dl-protect.link/abc?fn=x') == main_module.get_url_hash('https://dl-protect.link/abc')
    assert main_module.get_url_hash('https://dl-protect.link/abc') != main_module.get_url_hash('https://dl-protect.link/abd')


def test_local_cache_round_trip(main_module):
    url = 'https://dl-protect.link/cached'
    assert main_module.load_from_cache(url) is None
    main_module.save_to_cache(url, 'https://1fichier.com/?resolved')
    assert main_module.load_from_cache(url)['resolved_url'] == 'https://1fichier.com/?resolved'
    assert main_module.count_cache_entries() >= 1
    main_module.clear_cache()
    assert main_module.load_from_cache(url) is None


def test_health_route(client):
    body = client.get('/health').get_json()
    assert body['status'] == 'ok'
    assert 'cache_entries' in body
