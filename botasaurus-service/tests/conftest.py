"""Import main.py without a browser: botasaurus and OpenCV are stubbed."""
import os
import sys
import types

import pytest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _stub_browser_modules():
    cv2 = types.ModuleType('cv2')
    botasaurus = types.ModuleType('botasaurus')
    browser_mod = types.ModuleType('botasaurus.browser')
    cache_mod = types.ModuleType('botasaurus.cache')

    def browser(**_kwargs):
        def decorator(fn):
            return fn
        return decorator

    class Driver:  # pragma: no cover - placeholder type
        pass

    browser_mod.browser = browser
    browser_mod.Driver = Driver
    cache_mod.Cache = object
    sys.modules.setdefault('cv2', cv2)
    sys.modules.setdefault('botasaurus', botasaurus)
    sys.modules.setdefault('botasaurus.browser', browser_mod)
    sys.modules.setdefault('botasaurus.cache', cache_mod)


@pytest.fixture(scope='session')
def main_module(tmp_path_factory):
    _stub_browser_modules()
    os.environ['CACHE_DIR'] = str(tmp_path_factory.mktemp('cache'))
    os.environ.pop('LOADIX_MNEMONIC', None)
    os.environ.pop('LOADIX_EMAIL', None)
    os.environ.pop('LOADIX_PASSWORD', None)
    sys.path.insert(0, ROOT)
    import main  # noqa: E402
    return main


@pytest.fixture
def client(main_module):
    main_module.app.config['TESTING'] = True
    return main_module.app.test_client()
