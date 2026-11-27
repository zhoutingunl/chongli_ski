"""Real entry actions and projected camera motion. Run with npm run test:browser."""
import json
import os
from pathlib import Path
import re
import socket
import subprocess
import time
from urllib.parse import urlsplit
from urllib.request import urlopen
from playwright.sync_api import sync_playwright
from edge_probe import check_rendered_edges

ROOT = Path(__file__).resolve().parents[2]
VIEWS = ('front', 'follow', 'low', 'left', 'right', 'top', 'far', 'first', 'tips')


def check_lobby(browser, base):
    for width, height in [(393, 760), (800, 366), (1280, 800), (320, 560), (568, 270)]:
        page = browser.new_page(viewport={'width': width, 'height': height}, has_touch=True)
        errors = []
        page.on('pageerror', lambda exc: errors.append(str(exc)))
        try:
            page.goto(base)
            page.locator('#resort-choices [aria-pressed=true]').wait_for()
            page.locator('.lobby-picture img').evaluate('image => image.decode()')
            page.evaluate('document.fonts.ready')
            layout = page.locator('#home').evaluate('''home => {
              const box = home.getBoundingClientRect();
              return {size:[home.clientWidth,home.scrollWidth,home.clientHeight,home.scrollHeight],
                cover:home.querySelector('picture img').currentSrc.split('/').pop(),
                actions:[...home.querySelectorAll('button')].filter(b=>!b.hidden && b.offsetWidth).map(b=>{
                  const r=b.getBoundingClientRect(), x=r.x+r.width/2, y=r.y+r.height/2;
                  return {action:b.textContent, hit:b.contains(document.elementFromPoint(x,y)),
                    inside:r.left>=box.left-1&&r.right<=box.right+1&&r.bottom<=box.bottom+1};
                })};
            }''')
            w, scroll_w, h, scroll_h = layout['size']
            assert w == scroll_w and abs(h-scroll_h) <= 1, (width, height, layout)
            assert all(a['hit'] and a['inside'] for a in layout['actions']), (width, height, layout)
            wide = width > height and height <= 560 and width <= 1040
            assert layout['cover'] == ('ridgeline-wide.webp' if wide else 'ridgeline.webp')
            page.locator('#resort-choices [data-value=genting]').click()
            page.locator('#home-rider').click()
            panel = page.locator('#panel')
            assert panel.locator('[data-choice=gender]').count() == 4
            panel.locator('[data-choice=gender][data-value=girl]').click()
            panel.locator('[data-choice=gear][data-value=board]').click()
            swatches = panel.locator('[data-choice=color]')
            rows = swatches.evaluate_all('buttons=>buttons.map(b=>Math.round(b.getBoundingClientRect().top))')
            assert len(rows) == 6 and rows[0] == rows[1] == rows[2] < rows[3] == rows[4] == rows[5], rows
            colour = swatches.last
            name = colour.get_attribute('aria-label')
            colour.click()
            preview = panel.locator('.lobby-fit-preview .fitting-model')
            before = preview.get_attribute('style')
            panel.locator('[data-act=fitting-turn]').click()
            assert preview.get_attribute('style') != before
            panel.locator('[data-act=close-panel]').click()
            page.reload()
            summary = page.locator('#kit-rider')
            page.wait_for_function("document.getElementById('kit-rider')?.textContent.includes('女孩')")
            assert summary.inner_text() == '女孩 · 单板' and page.locator('#kit-colour').inner_text() == name
            assert page.locator('#resort-choices [aria-pressed=true]').get_attribute('data-value') == 'genting'
            if width == 393:
                for action, inside in [('map', '.map-regions'), ('help', '.controls-guide')]:
                    page.locator(f'#home [data-act={action}]').click()
                    panel.locator(inside).wait_for()
                    panel.locator('[data-act=close-panel]').click()
                page.locator('#home [data-act=scenery-start]').click()
                page.locator('#scenery-desk').wait_for(timeout=90000)
            if width == 320:
                page.evaluate("""() => {
                    const key='ridgeline.preferences.v1', prefs=JSON.parse(localStorage.getItem(key));
                    localStorage.setItem(key, JSON.stringify({...prefs, language:'en'}));
                }""")
                page.reload()
                page.get_by_role('button', name='Enter summit').wait_for()
                bounds = page.locator('#home').evaluate('home => [home.clientHeight,home.scrollHeight]')
                assert bounds[1] <= bounds[0] + 1, (width, 'English layout', bounds)
                page.locator('#home-rider').click()
                page.get_by_role('button', name='Close', exact=True).click()
            assert not errors, errors
        finally:
            page.close()
    print('PASS · departure choices, wardrobe, scene trial and map in five viewports', flush=True)


def check_cameras(browser, base):
    probe_url = '/scripts/browser-tests/camera-probe.js'
    observers = {
        'world.js': ('createWorld', 'observeWorld'),
        'rider.js': ('createRider', 'observeRider'),
        'three.js': ('WebGLRenderer', 'observeRenderer'),
    }
    for width, height in [(393, 760), (760, 393)]:
        page = browser.new_page(viewport={'width': width, 'height': height})
        errors = []
        page.on('pageerror', lambda exc: errors.append(str(exc)))

        def instrument(route):
            url = route.request.url
            if 'camera-original=1' in url:
                return route.continue_()
            factory, observe = observers[Path(urlsplit(url).path).name]
            original = json.dumps(url + ('&' if '?' in url else '?') + 'camera-original=1')
            module = f'''export * from {original};
              import {{ {factory} as create }} from {original};
              import {{ {observe} }} from "{probe_url}";
              export const {factory} = {observe}(create);'''
            route.fulfill(content_type='application/javascript', body=module)

        try:
            page.route(re.compile(r'/(src/(world|rider)|node_modules/\.vite/deps/three)\.js(?:\?.*)?$'), instrument)
            prefs = dict(resort='wanlong', gear='ski', gender='male', quality='lite', view='front',
                         time='day', weather='clear', variedMoves=True, assist=True, sound=False, music=False)
            page.add_init_script("localStorage.setItem('ridgeline.preferences.v1',"+json.dumps(json.dumps(prefs))+");")
            page.goto(base)
            page.locator('#home [data-act=start]').click()
            page.locator('#station-card').wait_for(timeout=90000)
            page.evaluate(f"async () => {{ window.measureCamera = (await import('{probe_url}')).measureCamera; }}")
            for view in VIEWS:
                for hz in (60, 120):
                    result = page.evaluate('([view,hz])=>window.measureCamera(view,hz)', [view, hz])
                    # Limits are CSS pixels of midpoint error, independent of device pixel ratio.
                    assert result['holds'] == 0 and result['count'] > hz*5, (view, hz, result)
                    assert result['scenery'] < (1.15 if hz == 60 else .40), (view, hz, result)
                    if result['helmet'] is not None:
                        assert result['helmet'] < (1.45 if hz == 60 else .52), (view, hz, result)
            assert not errors, errors
        finally:
            page.close()
    print('PASS · nine cameras on Jade Dragon at 60 and 120 Hz, portrait and landscape', flush=True)


def main():
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0))
        port = sock.getsockname()[1]
    base = f'http://127.0.0.1:{port}'
    proc = subprocess.Popen(['node','node_modules/vite/bin/vite.js','--host','127.0.0.1','--port',str(port),'--strictPort'], cwd=ROOT,
                            stdout=subprocess.DEVNULL)
    try:
        for _ in range(100):
            try:
                with urlopen(base, timeout=.5): break
            except OSError:
                if proc.poll() is not None: raise RuntimeError('Vite could not start')
                time.sleep(.1)
        else: raise RuntimeError('Vite did not become ready')
        with sync_playwright() as pw:
            browser = pw.chromium.launch(channel=os.environ.get('CHROME_CHANNEL') or None,
                                         args=['--ignore-gpu-blocklist','--enable-unsafe-swiftshader'])
            try:
                check_lobby(browser, base)
                check_cameras(browser, base)
                check_rendered_edges(browser, base)
            finally:
                browser.close()
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=8)
        except subprocess.TimeoutExpired:
            proc.kill()
            proc.wait()


if __name__ == '__main__':
    main()
