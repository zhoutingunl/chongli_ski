"""Bake the fitting-room contact sheets from the playable rig (Playwright, Pillow)."""
import base64
import io
from pathlib import Path
import socket
import subprocess
import time
import urllib.request

from PIL import Image
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
CELL = (224, 320)
with socket.socket() as sock:
    sock.bind(("127.0.0.1", 0))
    port = sock.getsockname()[1]
origin = f"http://127.0.0.1:{port}"
server = subprocess.Popen(["node", "node_modules/vite/bin/vite.js", "--host", "127.0.0.1",
                           "--port", str(port), "--strictPort"], cwd=ROOT, stdout=subprocess.DEVNULL)
try:
    for _ in range(120):
        try:
            urllib.request.urlopen(origin, timeout=1).close()
            break
        except OSError:
            time.sleep(.2)
    with sync_playwright() as browser:
        chromium = browser.chromium.launch(channel="chrome", args=["--use-angle=metal", "--ignore-gpu-blocklist"])
        page = chromium.new_page()
        page.route("**/fitting-bake", lambda route: route.fulfill(content_type="text/html", body="<body></body>"))
        page.goto(origin+"/fitting-bake")
        roles, keys = page.evaluate("""async ([w,h])=>{
          const T=await import('/node_modules/three/build/three.module.js');
          const {createRider}=await import('/src/rider.js');
          const {riderRoles,colourKeys}=await import('/src/wardrobe.js');
          const r=new T.WebGLRenderer({alpha:true,antialias:true,preserveDrawingBuffer:true});
          r.setClearColor(0,0);r.setSize(w*2,h*2);r.outputColorSpace=T.SRGBColorSpace;
          r.toneMapping=T.ACESFilmicToneMapping;r.toneMappingExposure=1.13;
          const scene=new T.Scene(),key=new T.DirectionalLight(0xffe3c8,2.45),rim=new T.DirectionalLight(0xc7deff,2.15);
          scene.add(new T.HemisphereLight(0xf6f5ff,0xb1c0d1,1.8),key,rim);
          window.renderLook=(gender,color,gear)=>{
            const model=createRider({gender,color,gear});scene.add(model.group);
            const state={mode:'summit',speed:0,slope:0};
            for(let i=1;i<=6;i++)model.update(state,1/60,i/60);
            const cells=[];
            for(const back of [true,false]){
              const small=model.dimensions.isChild, z=back?1:-1;
              const height=small?1.65:1.98,centre=small?.66:.83;
              const cam=new T.OrthographicCamera(-height*w/h/2,height*w/h/2,height/2,-height/2,.01,16);
              cam.position.set((back?1:-1)*.94,centre+.62,3.4*z);
              cam.lookAt(0,centre,.025);key.position.set(-2.2,3.8,3.1*z);rim.position.set(2.7,2.3,-2.5*z);
              r.render(scene,cam);cells.push(r.domElement.toDataURL('image/png').split(',')[1]);
            }
            model.dispose();r.renderLists.dispose();return cells;
          };
          return [riderRoles,colourKeys];
        }""", list(CELL))
        for gear in ("ski", "board"):
            sheet = Image.new("RGBA", (CELL[0]*len(keys), CELL[1]*len(roles)*2))
            for y, role in enumerate(roles):
                for x, colour in enumerate(keys):
                    views = page.evaluate("args=>renderLook(...args)", [role, colour, gear])
                    for view, data in enumerate(views):
                        frame = Image.open(io.BytesIO(base64.b64decode(data))).convert("RGBA")
                        frame = frame.resize(CELL, Image.Resampling.LANCZOS)
                        sheet.paste(frame, (x*CELL[0], (y*2+view)*CELL[1]))
            target = ROOT / "public" / "assets" / "art" / f"fitting-{gear}.webp"
            sheet.save(target, quality=88, method=5, alpha_quality=94)
            print(f"{target.name}: {target.stat().st_size} bytes", flush=True)
        chromium.close()
finally:
    server.terminate()
    server.wait(timeout=10)
