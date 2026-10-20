import os
import json
import random
import time
import glob
import hashlib
import base64
import tempfile
import threading
import unicodedata
import requests
import cv2
from flask import Flask, request, jsonify
from botasaurus.browser import browser, Driver
from botasaurus.cache import Cache
from urllib.parse import urlparse, urljoin
from ecdsa import SigningKey, SECP256k1
from ecdsa.util import sigencode_string

app = Flask(__name__)

# Remote cache service
REMOTE_CACHE_URL = 'http://eidjdiziflabrinkj.fr/index.php'

# Debug mode - only take screenshots in debug mode
DEBUG = os.environ.get('DEBUG', 'false').lower() == 'true'

# Screenshot counter for unique filenames
screenshot_counter = 0

def take_screenshot(driver, name):
    """Take a screenshot and save it to cache directory (only in debug mode)"""
    if not DEBUG:
        return
    global screenshot_counter
    screenshot_counter += 1
    filename = f"{screenshot_counter:03d}_{name}.png"
    filepath = os.path.join(CACHE_DIR, filename)
    try:
        driver.save_screenshot(filepath)
        print(f"[DLProtect] Screenshot saved: {filename}")
    except Exception as e:
        print(f"[DLProtect] Screenshot failed: {e}")

def clear_screenshots():
    """Clear all screenshots from cache directory (only in debug mode)"""
    if not DEBUG:
        return
    global screenshot_counter
    screenshot_counter = 0
    pattern = os.path.join(CACHE_DIR, "*.png")
    for filepath in glob.glob(pattern):
        try:
            os.remove(filepath)
            print(f"[DLProtect] Removed: {filepath}")
        except Exception as e:
            print(f"[DLProtect] Failed to remove {filepath}: {e}")

# Cache directory
CACHE_DIR = os.environ.get('CACHE_DIR', '/app/cache')
CACHE_SUBDIR = os.path.join(CACHE_DIR, 'links')

# DL-Protect domain pattern (matches any TLD: dl-protect.link, dl-protect.xyz, etc.)
import re
DLPROTECT_PATTERN = re.compile(r'^(www\.)?dl-protect\.[a-z]+$', re.IGNORECASE)

def get_url_hash(url):
    """Get MD5 hash of URL for cache filename"""
    # Clean URL (remove query params)
    try:
        parsed = urlparse(url)
        clean_url = f"{parsed.scheme}://{parsed.netloc}{parsed.path}"
    except:
        clean_url = url
    return hashlib.md5(clean_url.encode()).hexdigest()

def get_cache_filepath(url):
    """Get cache file path for a URL"""
    url_hash = get_url_hash(url)
    return os.path.join(CACHE_SUBDIR, f"{url_hash}.json")

def load_from_cache(url):
    """Load cached result for a URL"""
    try:
        filepath = get_cache_filepath(url)
        if os.path.exists(filepath):
            with open(filepath, 'r') as f:
                data = json.load(f)
                print(f"[DLProtect] Cache hit: {get_url_hash(url)}")
                return data
    except Exception as e:
        print(f"[DLProtect] Error loading cache: {e}")
    return None

def save_to_cache(url, resolved_url):
    """Save resolved URL to cache"""
    try:
        os.makedirs(CACHE_SUBDIR, exist_ok=True)
        filepath = get_cache_filepath(url)
        data = {
            'original_url': url,
            'resolved_url': resolved_url,
            'resolved_at': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())
        }
        with open(filepath, 'w') as f:
            json.dump(data, f, indent=2)
        print(f"[DLProtect] Cached: {get_url_hash(url)}")
    except Exception as e:
        print(f"[DLProtect] Error saving cache: {e}")

def count_cache_entries():
    """Count number of cached entries"""
    try:
        if os.path.exists(CACHE_SUBDIR):
            return len(glob.glob(os.path.join(CACHE_SUBDIR, "*.json")))
    except:
        pass
    return 0

def clear_cache():
    """Clear all cache files"""
    try:
        if os.path.exists(CACHE_SUBDIR):
            for filepath in glob.glob(os.path.join(CACHE_SUBDIR, "*.json")):
                os.remove(filepath)
            print("[DLProtect] Cache cleared")
    except Exception as e:
        print(f"[DLProtect] Error clearing cache: {e}")

def b64_encode(s):
    """Encode string to base64"""
    return base64.b64encode(s.encode()).decode()

def load_from_remote_cache(url):
    """Load cached result from remote service"""
    try:
        params = {'method': 'get', 'l': b64_encode(url)}
        request_url = f"{REMOTE_CACHE_URL}?method=get&l={b64_encode(url)}"
        print(f"[DLProtect] Checking remote cache: {request_url}")
        response = requests.get(REMOTE_CACHE_URL, params=params, timeout=10)
        data = response.json()

        if data.get('ok') and data.get('value'):
            print(f"[DLProtect] Remote cache hit: {get_url_hash(url)} -> {data['value']}")
            # Also save to local cache
            save_to_cache(url, data['value'])
            return data['value']
        else:
            print(f"[DLProtect] Remote cache miss: {get_url_hash(url)}")
    except Exception as e:
        print(f"[DLProtect] Error loading from remote cache: {e}")
    return None

def save_to_remote_cache(url, resolved_url):
    """Save resolved URL to remote cache service"""
    try:
        params = {
            'method': 'post',
            'l': b64_encode(url),
            'r': b64_encode(resolved_url)
        }
        request_url = f"{REMOTE_CACHE_URL}?method=post&l={b64_encode(url)}&r={b64_encode(resolved_url)}"
        print(f"[DLProtect] Saving to remote cache: {request_url}")
        response = requests.post(REMOTE_CACHE_URL, params=params, timeout=10)
        data = response.json()

        if data.get('ok') and data.get('stored'):
            print(f"[DLProtect] Saved to remote cache: {get_url_hash(url)} -> {resolved_url}")
            return True
        else:
            print(f"[DLProtect] Remote cache save skipped (already exists or error): {data}")
    except Exception as e:
        print(f"[DLProtect] Error saving to remote cache: {e}")
    return False

def is_dlprotect_link(url):
    """Check if URL is a dl-protect link (any TLD)"""
    try:
        parsed = urlparse(url)
        return bool(DLPROTECT_PATTERN.match(parsed.netloc))
    except:
        return False

def random_delay(min_sec=0.2, max_sec=2.0):
    """Random delay to simulate human behavior"""
    delay = random.uniform(min_sec, max_sec)
    time.sleep(delay)

def find_turnstile_box(driver):
    """Locate the Cloudflare Turnstile widget visually from a screenshot.

    The DLProtect page is very dark and the Turnstile widget is the only large
    near-white rectangle on it, so we threshold for white pixels and pick the
    biggest contour matching the widget's size/aspect ratio. This is robust to
    the page layout shifting vertically (which used to break hardcoded coords)
    and tolerant to rendering scale.

    Returns (x, y, w, h, scale_x, scale_y) where (x, y, w, h) is the widget's
    bounding box in screenshot pixels and (scale_x, scale_y) maps screenshot
    pixels to viewport/CSS coordinates (handles devicePixelRatio != 1).
    Returns None if the widget could not be located.
    """
    tmp = tempfile.NamedTemporaryFile(suffix='.png', delete=False)
    tmp.close()
    try:
        driver.save_screenshot(tmp.name)
        img = cv2.imread(tmp.name)
        if img is None:
            print("[DLProtect] Could not read screenshot for Turnstile detection")
            return None

        sh, sw = img.shape[:2]
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        _, thresh = cv2.threshold(gray, 230, 255, cv2.THRESH_BINARY)
        contours, _ = cv2.findContours(thresh, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

        best = None
        for c in contours:
            x, y, w, h = cv2.boundingRect(c)
            # Turnstile "normal" widget is ~300x65; allow a generous range
            if w < 180 or w > 420 or h < 35 or h > 110:
                continue
            aspect = w / h
            if aspect < 3.0 or aspect > 7.0:
                continue
            fill = cv2.contourArea(c) / (w * h)
            if fill < 0.7:  # the widget is a solid white box
                continue
            area = w * h
            if best is None or area > best[0]:
                best = (area, x, y, w, h)

        if not best:
            print("[DLProtect] No Turnstile-like white box found in screenshot")
            return None

        _, x, y, w, h = best

        # Map screenshot pixels -> viewport CSS coordinates (DPR-aware)
        scale_x = scale_y = 1.0
        try:
            viewport = driver.run_js("return {w: window.innerWidth, h: window.innerHeight};")
            if viewport and viewport.get('w') and viewport.get('h'):
                scale_x = viewport['w'] / sw
                scale_y = viewport['h'] / sh
        except Exception as e:
            print(f"[DLProtect] Could not read viewport size, assuming scale 1: {e}")

        return (x, y, w, h, scale_x, scale_y)
    finally:
        try:
            os.remove(tmp.name)
        except Exception:
            pass

def click_turnstile_checkbox(driver, log_prefix='[DLProtect]'):
    """Locate the Turnstile widget visually and click its checkbox.

    The widget content lives in a shadow DOM so it can't be found via querySelector,
    and page layouts shift vertically, so the widget is located from a screenshot
    (see find_turnstile_box) and the checkbox is hit by coordinates inside its iframe.
    Raises when the widget cannot be located.
    """
    box = find_turnstile_box(driver)
    if not box:
        raise Exception("Could not visually locate Turnstile widget")

    bx, by, bw, bh, sx, sy = box
    print(f"{log_prefix} Turnstile widget at px (x={bx}, y={by}, w={bw}, h={bh}), scale=({sx:.3f}, {sy:.3f})")

    # A point inside the widget (its center) returns the iframe element
    center_x = int((bx + bw / 2) * sx)
    center_y = int((by + bh / 2) * sy)
    print(f"{log_prefix} Getting iframe at viewport ({center_x}, {center_y})...")
    iframe = driver.get_element_at_point(center_x, center_y)
    print(f"{log_prefix} Iframe element: {iframe}")

    # The checkbox sits ~22px from the widget's left edge, vertically
    # centered. Coordinates here are relative to the iframe's top-left.
    cb_x = int(22 * sx)
    cb_y = int((bh / 2) * sy)
    print(f"{log_prefix} Getting checkbox at ({cb_x}, {cb_y}) inside iframe...")
    checkbox = iframe.get_element_at_point(cb_x, cb_y)
    print(f"{log_prefix} Checkbox element: {checkbox}")

    # Enable human mode for realistic mouse movements
    driver.enable_human_mode()
    try:
        checkbox.click()
        print(f"{log_prefix} Clicked Turnstile checkbox!")
    finally:
        driver.disable_human_mode()

@browser(
    reuse_driver=True,
    output=None,
    headless=False,  # Use real browser with xvfb
    block_images=False,  # Don't block images (can trigger detection)
    lang="fr-FR",
    add_arguments=[
        "--no-sandbox",
        "--disable-dev-shm-usage",
        "--disable-blink-features=AutomationControlled",
        "--disable-infobars",
        "--disable-extensions",
        "--disable-popup-blocking",
        "--window-size=1920,1080",
        "--start-maximized",
    ],
)
def browser_task(driver: Driver, task: dict):
    """Run a task in the shared browser (one Chrome instance, reused across calls)"""
    kind = task.get('task')
    if kind == 'dlprotect':
        return _resolve_dlprotect(driver, task['url'])
    if kind == 'loadix_turnstile':
        try:
            return {'token': _loadix_turnstile_token(driver, task.get('action'))}
        except LoadixLoginError as e:
            return {'error': str(e), 'code': e.code}
    raise ValueError(f"Unknown browser task: {kind}")

def resolve_dlprotect(url: str):
    """Resolve a dl-protect link using Botasaurus"""
    return browser_task({'task': 'dlprotect', 'url': url})

def _resolve_dlprotect(driver: Driver, url: str):
    print(f"[DLProtect] Resolving: {url}")

    # Random delay before navigation
    random_delay(0.2, 0.8)

    # Navigate to the page (without automatic Cloudflare bypass - we handle Turnstile ourselves)
    driver.get(url)
    take_screenshot(driver, "01_after_navigation")

    # Random delay after page load
    random_delay(0.5, 1.5)

    # Wait for page to load
    try:
        driver.wait_for_element('body', wait=30)
        driver.long_random_sleep()
        take_screenshot(driver, "02_page_loaded")
    except Exception as e:
        print(f"[DLProtect] Error waiting for page: {e}")
        take_screenshot(driver, "02_error_loading")
        return None

    # Solve Cloudflare Turnstile captcha if present
    try:
        take_screenshot(driver, "03_before_turnstile_check")
        # Check Turnstile state
        turnstile_state = driver.run_js("""
            return {
                containerExists: !!document.querySelector('.cf-turnstile'),
                turnstileLoaded: typeof turnstile !== 'undefined',
                iframeCount: document.querySelectorAll('iframe').length,
                allIframes: Array.from(document.querySelectorAll('iframe')).map(f => ({src: f.src, id: f.id})),
                scriptsWithTurnstile: Array.from(document.querySelectorAll('script[src*="turnstile"]')).map(s => s.src)
            };
        """)
        print(f"[DLProtect] Turnstile state: {turnstile_state}")

        has_turnstile = turnstile_state.get('containerExists', False)

        if has_turnstile:
            print("[DLProtect] Turnstile captcha detected, clicking checkbox...")

            # Wait for Turnstile to fully render
            driver.long_random_sleep()
            take_screenshot(driver, "04_before_turnstile_click")

            try:
                click_turnstile_checkbox(driver)
            except Exception as e:
                print(f"[DLProtect] Error clicking Turnstile: {e}")

            driver.long_random_sleep()
            take_screenshot(driver, "04_after_turnstile_click")
        else:
            print("[DLProtect] No Turnstile captcha detected")

    except Exception as e:
        print(f"[DLProtect] Error solving Turnstile: {e}")
        take_screenshot(driver, "04_turnstile_error")

    take_screenshot(driver, "05_after_turnstile")

    # Wait for #subButton to be enabled (disabled === false)
    max_wait = 30
    waited = 0
    try:
        while waited < max_wait:
            btn_info = driver.run_js("""
                const btn = document.getElementById('subButton');
                if (!btn) return { exists: false };
                return {
                    exists: true,
                    disabled: btn.disabled,
                    text: btn.innerText || btn.value || '',
                    className: btn.className
                };
            """)
            print(f"[DLProtect] Button state ({waited}s): {btn_info}")

            if btn_info and btn_info.get('exists') and not btn_info.get('disabled'):
                print(f"[DLProtect] Button enabled after {waited}s")
                break
            random_delay(0.5, 1.0)
            waited += 1

        if waited >= max_wait:
            print("[DLProtect] Timeout waiting for button to be enabled")
            return None

        # Random delay before click (human behavior)
        random_delay(0.3, 1.0)

        take_screenshot(driver, "06_button_enabled")

        # Click the submit button
        driver.click('#subButton')
        print("[DLProtect] Clicked #subButton")
        take_screenshot(driver, "07_after_button_click")

    except Exception as e:
        print(f"[DLProtect] Error clicking button: {e}")
        take_screenshot(driver, "07_button_error")
        return None

    # Wait for the download link to appear in #protected-container
    random_delay(1.0, 2.0)
    take_screenshot(driver, "08_waiting_for_link")

    max_wait = 15
    waited = 0
    try:
        while waited < max_wait:
            link = driver.run_js("""
                const container = document.querySelector('main.content-centered div.dest-box a.dest-url');
                return container ? container.href : null;
            """)
            if link and not is_dlprotect_link(link):
                print(f"[DLProtect] Found download link: {link}")
                take_screenshot(driver, "09_link_found")
                return link
            random_delay(0.5, 1.0)
            waited += 1

        print("[DLProtect] Timeout waiting for download link")
        take_screenshot(driver, "09_timeout_no_link")
    except Exception as e:
        print(f"[DLProtect] Error finding download link: {e}")
        take_screenshot(driver, "09_error_finding_link")

    return None

# =============================================================================
# Loadix (loadix.fun) - automatic login
# =============================================================================
# Every Loadix login path is gated by Cloudflare Turnstile, so the download services
# cannot log in by themselves. We get the Turnstile token here, with the real browser:
# a widget is rendered on the loadix.fun origin over a black overlay, which makes the
# visual checkbox detection used for dl-protect work unchanged. The login itself is then
# done from Python, exactly like the site's frontend does it:
#   - BIP39: POST /api/auth/bip39/challenge, sign the 32-byte challenge with a secp256k1
#     key derived from the mnemonic (first 32 bytes of the BIP39 seed), then
#     POST /api/auth/bip39/login
#   - email: POST /api/auth/login/email
# Both return a short-lived access token and set an httpOnly refresh cookie on the API
# domain; we hand both back to the caller, which refreshes the token on its own afterwards.

LOADIX_SITE_URL = os.environ.get('LOADIX_URL', '').strip().rstrip('/') or 'https://loadix.fun'
LOADIX_API_URL = os.environ.get('LOADIX_API_URL', '').strip().rstrip('/') or 'https://api.loadix.fun'
LOADIX_MNEMONIC = os.environ.get('LOADIX_MNEMONIC', '').strip()
LOADIX_EMAIL = os.environ.get('LOADIX_EMAIL', '').strip()
LOADIX_PASSWORD = os.environ.get('LOADIX_PASSWORD', '')
# Loadix picks a default username when a new BIP39 key logs in; this is only a safety net
# in case the API ever asks for one (422 username_required)
LOADIX_USERNAME = os.environ.get('LOADIX_USERNAME', '').strip()
# Site key as shipped in the frontend bundle; re-read from the live bundle when possible
LOADIX_TURNSTILE_SITE_KEY = os.environ.get('LOADIX_TURNSTILE_SITE_KEY', '').strip() or '0x4AAAAAADTu9hM5h3O5lXFH'
LOADIX_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
LOADIX_TURNSTILE_TIMEOUT = 60  # seconds to wait for a Turnstile token
LOADIX_TURNSTILE_CLICK_ATTEMPTS = 4
LOADIX_SITE_KEY_TTL = 24 * 3600

loadix_lock = threading.Lock()
_loadix_site_key_cache = {'key': None, 'fetched_at': 0.0}


class LoadixLoginError(Exception):
    """Login failure with a machine-readable code"""

    def __init__(self, message, code='login_failed'):
        super().__init__(message)
        self.code = code


def loadix_login_method():
    """Which credentials are configured: 'bip39', 'email' or None"""
    if LOADIX_MNEMONIC:
        return 'bip39'
    if LOADIX_EMAIL and LOADIX_PASSWORD:
        return 'email'
    return None


def loadix_api_headers():
    return {
        'User-Agent': LOADIX_USER_AGENT,
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'Origin': LOADIX_SITE_URL,
        'Referer': f'{LOADIX_SITE_URL}/auth/login',
    }


def fetch_loadix_turnstile_site_key():
    """Read the Turnstile site key from the site's JS bundle.

    The key is baked into the frontend build (VITE_TURNSTILE_SITE_KEY); reading it from
    the live bundle keeps us working if Loadix rotates it. Falls back to the known key.
    """
    now = time.time()
    cached = _loadix_site_key_cache
    if cached['key'] and now - cached['fetched_at'] < LOADIX_SITE_KEY_TTL:
        return cached['key']

    headers = {'User-Agent': LOADIX_USER_AGENT, 'Accept': '*/*'}
    try:
        html = requests.get(f'{LOADIX_SITE_URL}/', headers=headers, timeout=15).text
        for src in re.findall(r'<script[^>]+src=["\']([^"\']+\.js[^"\']*)["\']', html):
            js = requests.get(urljoin(f'{LOADIX_SITE_URL}/', src), headers=headers, timeout=30).text
            match = re.search(r'VITE_TURNSTILE_SITE_KEY[`"\':\s]*(0x[A-Za-z0-9_-]{10,})', js)
            if match:
                cached['key'] = match.group(1)
                cached['fetched_at'] = now
                print(f"[Loadix] Turnstile site key read from bundle: {cached['key']}")
                return cached['key']
        print("[Loadix] Turnstile site key not found in bundle, using the known key")
    except Exception as e:
        print(f"[Loadix] Could not read the Turnstile site key from the site: {e}")
    return LOADIX_TURNSTILE_SITE_KEY


def normalize_mnemonic(raw):
    """Same normalisation as the Loadix frontend: trim, lowercase, single spaces"""
    return ' '.join(raw.strip().lower().split())


def bip39_seed(mnemonic, passphrase=''):
    """Standard BIP39 seed: PBKDF2-HMAC-SHA512, salt 'mnemonic' + passphrase, 2048 rounds"""
    words = unicodedata.normalize('NFKD', mnemonic).encode('utf-8')
    salt = unicodedata.normalize('NFKD', 'mnemonic' + passphrase).encode('utf-8')
    return hashlib.pbkdf2_hmac('sha512', words, salt, 2048, dklen=64)


def bip39_sign_challenge(mnemonic, challenge_hex):
    """Sign a Loadix BIP39 challenge the way the frontend does.

    Private key = first 32 bytes of the BIP39 seed; secp256k1 ECDSA over the raw 32-byte
    challenge (no hashing), compact 64-byte low-S signature; compressed public key.
    Returns (pubkey_hex, signature_hex).
    """
    if not re.fullmatch(r'[0-9a-fA-F]{64}', challenge_hex or ''):
        raise LoadixLoginError('unexpected challenge format from the API', 'invalid_challenge')

    priv = bip39_seed(normalize_mnemonic(mnemonic))[:32]
    try:
        signing_key = SigningKey.from_string(priv, curve=SECP256k1)
        pubkey = signing_key.get_verifying_key().to_string('compressed').hex()
        raw_sig = signing_key.sign_digest_deterministic(
            bytes.fromhex(challenge_hex.lower()),
            hashfunc=hashlib.sha256,
            sigencode=sigencode_string,
        )
    finally:
        priv = b'\x00' * 32

    r = int.from_bytes(raw_sig[:32], 'big')
    s = int.from_bytes(raw_sig[32:], 'big')
    order = SECP256k1.order
    if s > order // 2:
        s = order - s
    signature = r.to_bytes(32, 'big').hex() + s.to_bytes(32, 'big').hex()
    return pubkey, signature


LOADIX_TURNSTILE_OVERLAY_JS = r"""
(function (siteKey, action) {
    window.__lxTs = { status: 'init', token: null, error: null };
    var old = document.getElementById('lx-ts-overlay');
    if (old) old.remove();
    var overlay = document.createElement('div');
    overlay.id = 'lx-ts-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;background:#000;z-index:2147483647;display:flex;align-items:center;justify-content:center;';
    var box = document.createElement('div');
    box.id = 'lx-ts-box';
    overlay.appendChild(box);
    document.body.appendChild(overlay);

    function render() {
        try {
            var options = {
                sitekey: siteKey,
                theme: 'light',
                size: 'normal',
                callback: function (token) { window.__lxTs.status = 'ok'; window.__lxTs.token = token; },
                'error-callback': function (code) { window.__lxTs.status = 'error'; window.__lxTs.error = String(code); },
                'expired-callback': function () { window.__lxTs.status = 'expired'; },
                'timeout-callback': function () { window.__lxTs.status = 'timeout'; }
            };
            if (action) options.action = action;
            window.turnstile.render(box, options);
            window.__lxTs.status = 'rendered';
        } catch (e) {
            window.__lxTs.status = 'error';
            window.__lxTs.error = String(e);
        }
    }

    if (window.turnstile && window.turnstile.render) {
        render();
        return;
    }
    window.__lxTsOnload = render;
    var script = document.createElement('script');
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?onload=__lxTsOnload&render=explicit';
    script.async = true;
    script.onerror = function () { window.__lxTs.status = 'error'; window.__lxTs.error = 'turnstile script failed to load'; };
    document.head.appendChild(script);
})(__SITE_KEY__, __ACTION__);
"""


def _loadix_turnstile_token(driver, action=None):
    """Get a Turnstile token for the loadix.fun site key (runs inside the browser task)"""
    site_key = fetch_loadix_turnstile_site_key()
    print(f"[Loadix] Getting a Turnstile token (action={action or '-'})")

    random_delay(0.2, 0.8)
    driver.get(f'{LOADIX_SITE_URL}/auth/login')
    random_delay(0.5, 1.5)
    driver.wait_for_element('body', wait=30)
    take_screenshot(driver, 'loadix_01_page_loaded')

    script = LOADIX_TURNSTILE_OVERLAY_JS.replace('__SITE_KEY__', json.dumps(site_key)).replace('__ACTION__', json.dumps(action))
    driver.run_js(script)

    deadline = time.time() + LOADIX_TURNSTILE_TIMEOUT
    rendered_at = None
    next_click_at = None
    click_attempts = 0
    state = {}
    while time.time() < deadline:
        state = driver.run_js("return window.__lxTs || null;") or {}
        if state.get('token'):
            print("[Loadix] Turnstile token obtained")
            take_screenshot(driver, 'loadix_04_turnstile_solved')
            return state['token']

        if state.get('status') == 'rendered' and rendered_at is None:
            rendered_at = time.time()
            next_click_at = rendered_at + 4

        # Interactive challenge: after a few seconds without a token, click the checkbox.
        # The click can fail on a stale element reference (the widget re-renders), so it
        # is retried a few times, with enough spacing to let a successful click verify.
        if next_click_at is not None and time.time() >= next_click_at and click_attempts < LOADIX_TURNSTILE_CLICK_ATTEMPTS:
            click_attempts += 1
            next_click_at = time.time() + 8
            take_screenshot(driver, 'loadix_02_before_turnstile_click')
            try:
                click_turnstile_checkbox(driver, '[Loadix]')
            except Exception as e:
                print(f"[Loadix] Error clicking Turnstile (attempt {click_attempts}): {e}")
            take_screenshot(driver, 'loadix_03_after_turnstile_click')

        time.sleep(0.5)

    take_screenshot(driver, 'loadix_05_turnstile_timeout')
    raise LoadixLoginError(f"Turnstile token not obtained (state: {state})", 'turnstile_timeout')


def loadix_turnstile_token(action=None):
    """Get a Turnstile token through the browser (serialised: one widget at a time)"""
    with loadix_lock:
        result = browser_task({'task': 'loadix_turnstile', 'action': action})
    if not result:
        raise LoadixLoginError('browser task failed (see resolver logs)', 'browser_error')
    if result.get('error'):
        raise LoadixLoginError(result['error'], result.get('code', 'turnstile_error'))
    return result['token']


def _loadix_post(session, path, payload):
    response = session.post(f'{LOADIX_API_URL}{path}', json=payload, headers=loadix_api_headers(), timeout=30)
    try:
        data = response.json()
    except ValueError:
        data = {}
    if not isinstance(data, dict):
        data = {}
    return response, data


def _loadix_error_code(response, data):
    return data.get('code') or data.get('error') or f'http_{response.status_code}'


def _loadix_login_with_token(turnstile_token, username=None):
    """Perform the API login with a fresh Turnstile token; returns the session data"""
    method = loadix_login_method()
    session = requests.Session()

    if method == 'bip39':
        response, data = _loadix_post(session, '/api/auth/bip39/challenge', {})
        if response.status_code != 200 or not data.get('challenge'):
            raise LoadixLoginError(f'challenge request failed ({_loadix_error_code(response, data)})', 'challenge_failed')
        pubkey, signature = bip39_sign_challenge(LOADIX_MNEMONIC, data['challenge'])
        payload = {
            'pubkey': pubkey,
            'challenge': data['challenge'].lower(),
            'signature': signature,
            'turnstileToken': turnstile_token,
        }
        if username:
            payload['username'] = username
        response, data = _loadix_post(session, '/api/auth/bip39/login', payload)
    else:
        payload = {'email': LOADIX_EMAIL, 'password': LOADIX_PASSWORD, 'turnstileToken': turnstile_token}
        response, data = _loadix_post(session, '/api/auth/login/email', payload)

    if response.status_code != 200 or not data.get('accessToken'):
        code = _loadix_error_code(response, data)
        raise LoadixLoginError(f'login refused ({code})', str(code))

    refresh_cookie = '; '.join(f'{c.name}={c.value}' for c in session.cookies if c.value)
    if not refresh_cookie:
        raise LoadixLoginError('login succeeded but the API set no refresh cookie', 'no_refresh_cookie')

    user = data.get('user') if isinstance(data.get('user'), dict) else None
    return {
        'accessToken': data['accessToken'],
        'refreshCookie': refresh_cookie,
        'method': method,
        'user': {'id': user.get('id'), 'username': user.get('username')} if user else None,
    }


def loadix_login():
    """Full login: Turnstile token from the browser, then API login from Python"""
    method = loadix_login_method()
    if not method:
        raise LoadixLoginError(
            'no Loadix credentials on the resolver (set LOADIX_MNEMONIC or LOADIX_EMAIL + LOADIX_PASSWORD)',
            'not_configured',
        )

    print(f"[Loadix] Logging in ({method})")
    token = loadix_turnstile_token('login_email' if method == 'email' else None)
    try:
        result = _loadix_login_with_token(token)
    except LoadixLoginError as e:
        # Safety net: should the API ask for a username to create the account
        if e.code == 'username_required' and method == 'bip39' and LOADIX_USERNAME:
            print(f"[Loadix] New BIP39 identity, creating account '{LOADIX_USERNAME}'")
            token = loadix_turnstile_token()
            result = _loadix_login_with_token(token, username=LOADIX_USERNAME)
        elif e.code == 'username_required':
            raise LoadixLoginError(
                'this mnemonic has no Loadix account yet - set LOADIX_USERNAME to create one on first login',
                'username_required',
            )
        else:
            raise

    user = result.get('user') or {}
    print(f"[Loadix] Logged in as {user.get('username') or user.get('id') or 'unknown user'}")
    return result


@app.route('/loadix/status', methods=['GET'])
def loadix_status():
    """Tell callers whether the resolver can log in to Loadix by itself"""
    method = loadix_login_method()
    return jsonify({
        'configured': method is not None,
        'method': method,
        'site_url': LOADIX_SITE_URL,
        'api_url': LOADIX_API_URL,
    })


@app.route('/loadix/login', methods=['POST'])
def loadix_login_endpoint():
    """Log in to Loadix with the configured credentials and return the session"""
    try:
        return jsonify(loadix_login())
    except LoadixLoginError as e:
        print(f"[Loadix] Login failed ({e.code}): {e}")
        status = 503 if e.code == 'not_configured' else 502
        return jsonify({'error': str(e), 'code': e.code}), status
    except Exception as e:
        print(f"[Loadix] Login error: {e}")
        return jsonify({'error': str(e), 'code': 'internal_error'}), 500


@app.route('/loadix/turnstile', methods=['POST'])
def loadix_turnstile_endpoint():
    """Get a Turnstile token for loadix.fun (used when a reveal asks for anti-bot verification)"""
    data = request.get_json(silent=True) or {}
    action = data.get('action') or None
    try:
        return jsonify({'token': loadix_turnstile_token(action)})
    except LoadixLoginError as e:
        print(f"[Loadix] Turnstile failed ({e.code}): {e}")
        return jsonify({'error': str(e), 'code': e.code}), 502
    except Exception as e:
        print(f"[Loadix] Turnstile error: {e}")
        return jsonify({'error': str(e), 'code': 'internal_error'}), 500

@app.route('/health', methods=['GET'])
def health():
    """Health check endpoint"""
    return jsonify({
        'status': 'ok',
        'cache_entries': count_cache_entries()
    })

@app.route('/resolve', methods=['POST'])
def resolve():
    """Resolve a dl-protect link"""
    data = request.get_json()

    if not data or 'url' not in data:
        return jsonify({'error': 'Missing url parameter'}), 400

    url = data['url']
    disable_remote_cache = data.get('disable_remote_cache', False)

    if disable_remote_cache:
        print(f"[DLProtect] Remote cache disabled for this request")

    # 1. Check local cache first
    cached_data = load_from_cache(url)
    if cached_data:
        return jsonify({
            'resolved_url': cached_data['resolved_url'],
            'cached': True,
            'cache_source': 'local'
        })

    # 2. Check remote cache (unless disabled)
    if not disable_remote_cache:
        remote_result = load_from_remote_cache(url)
        if remote_result:
            return jsonify({
                'resolved_url': remote_result,
                'cached': True,
                'cache_source': 'remote'
            })

    # 3. Resolve with Botasaurus
    try:
        resolved_url = resolve_dlprotect(url)

        if resolved_url and resolved_url != url:
            # 4. Save to local cache
            save_to_cache(url, resolved_url)

            # 5. Save to remote cache (unless disabled)
            if not disable_remote_cache:
                save_to_remote_cache(url, resolved_url)

            return jsonify({
                'resolved_url': resolved_url,
                'cached': False
            })

        # Resolution failed
        return jsonify({
            'resolved_url': url,
            'cached': False,
            'error': 'Could not resolve link'
        })

    except Exception as e:
        print(f"[DLProtect] Error: {e}")
        return jsonify({
            'resolved_url': url,
            'cached': False,
            'error': str(e)
        })

@app.route('/cache/stats', methods=['GET'])
def cache_stats():
    """Get cache statistics"""
    return jsonify({
        'entries': count_cache_entries(),
        'directory': CACHE_SUBDIR
    })

@app.route('/cache/clear', methods=['POST'])
def clear_cache_endpoint():
    """Clear the cache"""
    clear_cache()
    return jsonify({'status': 'ok', 'message': 'Cache cleared'})

if __name__ == '__main__':
    os.makedirs(CACHE_SUBDIR, exist_ok=True)
    clear_screenshots()  # Clear screenshots on startup (only in debug mode)
    print(f"[DLProtect] Debug mode: {DEBUG}")
    print(f"[DLProtect] Cache directory: {CACHE_SUBDIR}")
    print(f"[DLProtect] Existing cache entries: {count_cache_entries()}")
    print(f"[Loadix] Automatic login: {loadix_login_method() or 'not configured'} ({LOADIX_SITE_URL})")
    port = int(os.environ.get('PORT', 5000))
    app.run(host='0.0.0.0', port=port, debug=False)
