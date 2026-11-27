"""Exercise both reported finishes through the real HUD and simulation events."""
import json


def check_runouts(browser, base):
    for flat in (False, True):
        page = browser.new_page(viewport={'width': 844, 'height': 390}, has_touch=True)
        errors = []
        page.on('pageerror', lambda e: errors.append(str(e)))

        def serve_main(req):
            response = req.fetch()
            # Move only the test skier to the last metre. The game detects
            # the finish on its own frame and handles all later input.
            probe = """
            window.approachFinish = name => {
              launch(data.pisteRoutes.find(r=>r.name===name));
              const s=world.sim,r=s.route,along=r.length-.18,f=r.frame(along),y=data.height(f.x,f.z);
              Object.assign(s,{along,x:f.x,z:f.z,ground:y,y,speed:1,heading:f.angle,travelHeading:f.angle,travel:650,elapsed:60});
              s.surface();
            };
            window.runoutState = () => ({screen, flat:!!world?.flat, distance:world.sim.travel,
              free:world.sim.freeSnowfront, target:world.sim.route.approach?.target});
            """
            req.fulfill(response=response, body=response.text()+'\n'+probe)

        def force_lightweight(req):
            response = req.fetch()
            req.fulfill(response=response, body=response.text().replace('isMiniTool = false','isMiniTool = true'))

        def mini_entry(req):
            response = req.fetch()
            # This status element is supplied by build-xiaohongshu.mjs.
            html = response.text().replace('<div class="departure-resort">','<p id="boot-status"></p><div class="departure-resort">')
            req.fulfill(response=response, body=html)

        try:
            prefs = dict(resort='genting', gear='ski', quality='lite', sound=False, music=False,
                         assist=True, variedMoves=False, time='night', weather='clear')
            page.add_init_script('localStorage.setItem("ridgeline.preferences.v1",'+json.dumps(json.dumps(prefs))+');')
            page.route('**/src/main.js*', serve_main)
            if flat:
                page.route(base+'/', mini_entry)
                page.route('**/src/platform.js*', force_lightweight)
                page.route('**/src/world.js*', lambda req: req.abort())
            page.goto(base)
            page.locator('#home [data-act=start]').tap()
            page.locator('#station-card').wait_for(timeout=90000)
            assert page.evaluate('runoutState().flat') == flat
            exit_button = page.locator('#base-actions [data-act=continue-base]')
            page.evaluate("approachFinish('雪上技巧')")
            exit_button.wait_for()
            assert '芍药花' in exit_button.inner_text()
            exit_button.tap()
            page.wait_for_function("runoutState().screen==='run' && runoutState().distance>653")
            assert page.evaluate('runoutState().target') == '芍药花'

            page.evaluate("approachFinish('太浩岩壁')")
            alternate = page.locator('#base-actions [data-act=continue-piste]')
            alternate.wait_for()
            assert '一索' in exit_button.inner_text() and '风铃草' in alternate.inner_text()
            alternate.tap()
            page.wait_for_function("runoutState().screen==='run' && runoutState().target==='风铃草'")

            page.set_viewport_size({'width': 393, 'height': 760})
            page.evaluate("approachFinish('风铃草')")
            exit_button.wait_for()
            assert '沿雪面继续滑' in exit_button.inner_text()
            records = "()=>JSON.parse(localStorage.getItem('ridgeline.descents.v1'))"
            before = page.evaluate(records)
            page.keyboard.press('ArrowUp')
            page.wait_for_function("runoutState().screen==='run' && runoutState().free && runoutState().distance>653")
            page.locator('#near-lift').tap()
            page.locator('#lift-strip').wait_for()
            assert '22索' in page.locator('#lift-text').inner_text()
            after = page.evaluate(records)
            assert len(after) == len(before) and after[-1]['sessionId'] == before[-1]['sessionId']
            assert after[-1]['dist'] > before[-1]['dist']+2
            assert not errors, errors
        finally:
            page.close()
    print('PASS · summit transfers, training and 22-chair runouts through the 3D and lightweight HUDs', flush=True)
