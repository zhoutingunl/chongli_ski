import json
from pathlib import Path


def check_rendered_edges(browser, base):
    probe = Path(__file__).with_name('edge-probe.js').read_text()
    page = browser.new_page(viewport={'width': 460, 'height': 660})
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.on('console', lambda m: errors.append(m.text)
            if m.type == 'error' and ('shader' in m.text.lower() or 'webgl' in m.text.lower()) else None)

    def inject(route):
        response = route.fetch()
        code = response.text()
        pin = 'function kick(){'
        assert pin in code
        code = code.replace(pin, probe + '\nwindow.checkRenderedEdges=checkRenderedEdges;\n' +
                            'function kick(){if(window.edgeTest)return;')
        code = code.replace('function renderFrame(){', 'function renderFrame(){if(window.edgeTest)return;')
        route.fulfill(response=response, body=code)

    try:
        prefs = dict(resort='wanlong', gear='ski', gender='female', color='#aa5536', quality='lite',
                     view='follow', weather='clear', time='evening', variedMoves=False, assist=True)
        page.add_init_script('localStorage.setItem("ridgeline.preferences.v1",' +
                             json.dumps(json.dumps(prefs)) + ');')
        page.route('**/src/world.js*', inject)
        page.goto(base)
        page.locator('#home [data-act=start]').click(timeout=75000)
        page.wait_for_function('typeof window.checkRenderedEdges==="function"', timeout=90000)
        # Wait until the ordinary entry code has finished staging the first station.
        page.locator('[data-act=station-map]:visible, [data-act=station-down]:visible, #hud:not([hidden])').first.wait_for(timeout=90000)
        result = page.evaluate('window.checkRenderedEdges()')
        assert result['name'] == '金龙道' and result['minimumSpeed'] > 75, result
        assert result['grounded'] >= 109 and -.025 < result['clearance'] < -.004, result
        assert result['rise'] > .038, result
        assert result['removed'] == 2 and 100 < result['changed'] and result['fraction'] < .25, result
        assert not errors, errors
        print('PASS · Jinlong working edges, no-spray WebGL readback', result, flush=True)
    finally:
        page.close()
