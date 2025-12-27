import os
import json
import random
import time
import glob
import hashlib
import base64
import requests
from flask import Flask, request, jsonify
from botasaurus.browser import browser, Driver
from botasaurus.cache import Cache
from urllib.parse import urlparse

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

# DL-Protect domains
DLPROTECT_DOMAINS = ['dl-protect.link', 'dl-protect.net', 'dl-protect.org']

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
    """Check if URL is a dl-protect link"""
    try:
        parsed = urlparse(url)
        return any(domain in parsed.netloc for domain in DLPROTECT_DOMAINS)
    except:
        return False

def random_delay(min_sec=0.2, max_sec=2.0):
    """Random delay to simulate human behavior"""
    delay = random.uniform(min_sec, max_sec)
    time.sleep(delay)

@browser(
    reuse_driver=True,
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
def resolve_dlprotect(driver: Driver, url: str):
    """Resolve a dl-protect link using Botasaurus"""
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
                # Locate iframe containing the Cloudflare challenge (at position 840, 290)
                print("[DLProtect] Getting iframe at position (840, 290)...")
                iframe = driver.get_element_at_point(840, 290)
                print(f"[DLProtect] Iframe element: {iframe}")

                # Find checkbox element within the iframe (at 30, 30 inside iframe)
                print("[DLProtect] Getting checkbox at (30, 30) inside iframe...")
                checkbox = iframe.get_element_at_point(30, 30)
                print(f"[DLProtect] Checkbox element: {checkbox}")

                # Enable human mode for realistic mouse movements
                driver.enable_human_mode()

                # Click the checkbox
                checkbox.click()
                print("[DLProtect] Clicked Turnstile checkbox!")

                driver.disable_human_mode()

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
                const container = document.querySelector('#protected-container .col-md-12 a');
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

    # 1. Check local cache first
    cached_data = load_from_cache(url)
    if cached_data:
        return jsonify({
            'resolved_url': cached_data['resolved_url'],
            'cached': True,
            'cache_source': 'local'
        })

    # 2. Check remote cache
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

            # 5. Save to remote cache
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
    port = int(os.environ.get('PORT', 5000))
    app.run(host='0.0.0.0', port=port, debug=False)
