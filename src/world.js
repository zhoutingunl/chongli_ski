import * as THREE from 'three';
import {createRider} from './rider.js';
import {createLandmark,createLift} from './resort.js';
import {Descent} from './simulation.js';
import {createSky,buildSurface,plantForest,environments} from './landscape.js';
import {courseDetails,makeSnowFX} from './details.js';
import {clamp,mixAngle} from './mountain.js';

const up=new THREE.Vector3(0,1,0);
export async function createWorld(el,data,opts,onEvent,onProgress=()=>{}) {
  const renderer=new THREE.WebGLRenderer({canvas:el,antialias:true,alpha:false,powerPreference:'high-performance',stencil:false});
  renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.02;
  renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFShadowMap;
  const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(64,1,.09,55000);
  scene.fog=new THREE.FogExp2(0xc9d5db,.00011);
  const sun=new THREE.DirectionalLight(0xffe7cc,1.55),hemi=new THREE.HemisphereLight(0xe9f3ff,0x8d9aab,1.6);
  sun.shadow.camera.left=sun.shadow.camera.bottom=-11;sun.shadow.camera.right=sun.shadow.camera.top=11;
  sun.shadow.camera.near=3;sun.shadow.camera.far=78;sun.shadow.mapSize.set(512,512);sun.shadow.bias=-.00024;sun.shadow.normalBias=.025;
  sun.castShadow=true;scene.add(sun,sun.target,hemi);
  const sky=createSky(scene),source=new THREE.Vector3();
  let forest,surface;
  onProgress('铺展雪道与远山');
  await Promise.all([buildSurface(scene,data).then(s=>{surface=s;}),plantForest(scene,data).then(f=>{forest=f;})]);
  onProgress('装配雪具与索道');await new Promise(r=>setTimeout(r,0));
  const rotations={wanlong:{lodge:-2.92,hall:.17},genting:{lodge:1.72,hall:-1.86}};
  const landmarks=[],photoPlaces=new Map();
  for(const k of data.landmarks.filter(l=>l.kind==='lodge'||l.kind==='hall')){
    const group=createLandmark(k.kind==='lodge'?'summit':'base',k.resort);group.position.set(k.x,data.height(k.x,k.z)-.04,k.z);group.rotation.y=rotations[k.resort][k.kind];scene.add(group);landmarks.push(group);
    const box=new THREE.Box3().setFromObject(group),size=new THREE.Vector3();box.getSize(size);
    const focus=box.getCenter(new THREE.Vector3());focus.y=group.position.y+size.y*.46;
    photoPlaces.set(k.id,{focus,yaw:group.rotation.y,distance:Math.max(22,Math.hypot(size.x,size.z)*.70),kind:k.kind});
  }
  const lifts=[];
  for(const lift of data.lifts){
    const points=lift.points.map(([x,z])=>new THREE.Vector3(x,data.height(x,z),z));
    if(points.length===2){const end=points.pop(),start=points[0],n=Math.ceil(start.distanceTo(end)/122);
      for(let i=1;i<n;i++){const t=i/n,x=start.x+(end.x-start.x)*t,z=start.z+(end.z-start.z)*t;points.push(new THREE.Vector3(x,data.height(x,z),z));} points.push(end);}
    const obj=createLift({...lift,type:lift.kind,points,heightAt:(x,z)=>data.height(x,z)});
    scene.add(obj.group);
    const distance=points.reduce((sum,p,i)=>i?sum+p.distanceTo(points[i-1]):0,0);
    const center=points[0].clone().lerp(points.at(-1),.5);
    const casters=[];obj.group.traverse(child=>{if(child.isMesh&&child.castShadow)casters.push(child);});
    lifts.push({...obj,meta:lift,distance,center,casters,radius:points[0].distanceTo(points.at(-1))*.5+200});
  }
  const details=courseDetails(scene,data);
  const fx=makeSnowFX(scene,data);
  let rider=createRider(opts);scene.add(rider.group);
  const sim=new Descent(data,opts);
  const yawQ=new THREE.Quaternion(),tiltQ=new THREE.Quaternion(),surfNorm=new THREE.Vector3(),want=new THREE.Vector3(),look=new THREE.Vector3(),target=new THREE.Vector3();
  let active=false,paused=false,photo=false,orbitYaw=0,orbitPitch=.10,orbitZoom=5.9,ride=null,clock=0,prev=0,lastUI=0,simLag=0,treesLag=1,camHeading=0,snap=true,frame=0,graphicsScale=1;
  let photoSite=null;
  let freeYaw=0,freePitch=0,holdingOrbit=false;
  const input={steer:0,brake:false,boost:false};
  const host=el.parentElement;
  function resize(){
    const width=host.clientWidth||innerWidth,height=host.clientHeight||innerHeight;
    const maxDpr=opts.quality==='lite'?1:opts.quality==='high'?1.8:1.4;
    renderer.setPixelRatio(Math.min(devicePixelRatio||1,maxDpr)*graphicsScale);renderer.setSize(width,height,false);
    camera.aspect=width/height;camera.updateProjectionMatrix();kick();
  }
  const observer=new ResizeObserver(resize);observer.observe(host);resize();
  function environment(){
    const e=environments[opts.env]||environments.morning;sky.apply(e);forest.setLight(e);surface.setLight(e);
    scene.fog.color.set(e.fog);scene.fog.density=e.density;sun.color.set(e.sun);sun.intensity=e.light;
    hemi.intensity=e.ambient;hemi.color.set(opts.env==='dusk'?0xf1dacf:0xddeaff);source.fromArray(e.dir).normalize();
    renderer.toneMappingExposure=opts.env==='dusk'?.96:1.03;
  }
  environment();
  function updateAvatar(dt){
    const p=sim;
    rider.group.visible=!ride && !(opts.view==='first'&&!photo);
    const tipsOnly=opts.view==='tips'&&!photo;
    for(const child of rider.group.children)child.visible=!tipsOnly||/^(Left ski|Right ski|Snowboard)$/.test(child.name);
    rider.group.position.set(p.x,p.y+.032,p.z);
    surfNorm.set((data.height(p.x-2,p.z)-data.height(p.x+2,p.z))/4,1,(data.height(p.x,p.z-2)-data.height(p.x,p.z+2))/4).normalize();
    if(p.airHeight>.1)surfNorm.lerp(up,clamp(p.airHeight*.8,0,1)).normalize();
    tiltQ.setFromUnitVectors(up,surfNorm);yawQ.setFromAxisAngle(up,-p.heading);tiltQ.multiply(yawQ);
    if(snap)rider.group.quaternion.copy(tiltQ);else rider.group.quaternion.slerp(tiltQ,1-Math.exp(-dt*10));
    rider.update({time:clock,dt,speed:p.speed,steer:p.steer,brake:p.brake,air:clamp(p.airHeight,0,1),boost:p.boost});
  }
  function moveCamera(dt){
    const p=sim,mode=opts.view;
    const smoothing=snap?1:1-Math.exp(-dt*6.5);
    camHeading=snap?p.heading:mixAngle(camHeading,p.heading,1-Math.exp(-dt*4.6));
    if(!holdingOrbit){freeYaw*=Math.exp(-dt*4);freePitch*=Math.exp(-dt*4);}
    const a=camHeading+(photo||ride?0:freeYaw),fx=Math.sin(a),fz=-Math.cos(a),rx=-fz,rz=fx;
    const dx=(back,side)=>p.x-fx*back+rx*side,dz=(back,side)=>p.z-fz*back+rz*side;
    let fov=61;
    if(ride){
      const eye=ride.lift.seatAt(ride.t),ahead=ride.lift.seatAt(Math.min(.99999,ride.t+.017));
      const h=ride.look+Math.atan2(ahead.x-eye.x,-(ahead.z-eye.z));want.copy(eye).addScaledVector(up,.28);
      look.set(eye.x+Math.sin(h)*17,eye.y+1+ride.pitch*12,eye.z-Math.cos(h)*17);fov=73;
    }else if(photo){
      const focus=photoSite?.focus;
      const theta=photoSite ? -photoSite.yaw+orbitYaw : a+orbitYaw;
      const reach=orbitZoom*Math.cos(orbitPitch);
      look.set(focus?.x??p.x,focus?.y??(p.y+.96),focus?.z??p.z);
      want.set(look.x-Math.sin(theta)*reach,look.y+.32+Math.sin(orbitPitch)*orbitZoom,look.z+Math.cos(theta)*reach);
      want.y=Math.max(want.y,data.height(want.x,want.z)+.4);fov=52;
    }else if(mode==='first'||mode==='tips'){
      const tip=mode==='tips';const x=dx(tip?.15:-.24,0),z=dz(tip?.15:-.24,0);want.set(x,p.y+(tip?.93:1.59),z);
      const reach=tip?2.1:19;look.set(x+fx*reach,p.y+(tip?-.59:1.42)-Math.tan(p.slope*Math.PI/180)*reach*.69,z+fz*reach);fov=tip?76:75;
    }else if(mode==='top'){
      want.set(dx(1.6,0),p.y+26,dz(1.6,0));look.set(dx(-.45,0),p.y,dz(-.45,0));fov=54;
    }else{
      let back=5,side=0,lift=1.92,lead=5.6,eye=1.42;
      if(mode==='low'){back=3.3;lift=.37;lead=3.2;eye=1.07;fov=70;}
      if(mode==='left'||mode==='right'){back=1.7;side=mode==='right'?5:-5;lift=1.45;lead=.65;eye=.96;}
      if(mode==='front'){back=-4.4;side=.38;lift=1.45;lead=0;eye=1.03;}
      if(mode==='far'){back=15;side=4.4;lift=4.8;lead=3.4;eye=1.2;}
      const x=dx(back,side),z=dz(back,side);const cy=Math.max(p.y+lift,data.height(x,z)+lift);
      want.set(x,cy,z);look.set(dx(-lead,0),p.y+eye-Math.tan(p.slope*Math.PI/180)*lead*.78,dz(-lead,0));
      if(mode==='follow')fov=60+clamp(p.speed*.20,0,5);
    }
    if(snap){camera.position.copy(want);target.copy(look);}else{camera.position.lerp(want,smoothing);target.lerp(look,smoothing);}
    if(!ride)camera.position.y=Math.max(camera.position.y,data.height(camera.position.x,camera.position.z)+.17);
    camera.up.copy(up);camera.lookAt(target);if(!photo&&!ride&&Math.abs(freePitch)>.001)camera.rotateX(freePitch);if(Math.abs(camera.fov-fov)>.06){camera.fov=fov;camera.updateProjectionMatrix();}
    sky.mesh.position.copy(camera.position);sun.target.position.set(p.x,p.y,p.z);
    sun.position.copy(sun.target.position).addScaledVector(source,32);
    snap=false;
  }
  function refreshLOD(){
    details.locate(camera.position.x,camera.position.z);
    forest.locate(camera.position.x,camera.position.z,opts.quality);
    const max=opts.quality==='lite'?1400:2400;
    for(const l of lifts){
      l.group.visible=l===ride?.lift||Math.hypot(l.center.x-camera.position.x,l.center.z-camera.position.z)<max+l.radius;
      const shadow=l.group.visible && opts.quality==='high' && l.meta.points.some(([x,z])=>Math.hypot(x-sim.x,z-sim.z)<55);
      for(const mesh of l.casters)mesh.castShadow=shadow;
      if(photo&&l.group.visible)l.update(clock,camera);
    }
    for(const g of landmarks)g.visible=Math.hypot(g.position.x-camera.position.x,g.position.z-camera.position.z)<(opts.quality==='lite'?1800:3400);
  }
  function setPhotoPlace(kind){
    const side=sim.mode==='finished'?sim.route.destination:
      (['wanlong','genting'].includes(sim.trail?.resort)?sim.trail.resort:sim.route.resort);
    photoSite=photoPlaces.get(side+'-'+kind)||null;orbitYaw=photoSite?.kind==='hall'?-.13:0;
    orbitZoom=photoSite?.distance||5.9;orbitPitch=photoSite?.kind==='hall'?.13:.15;snap=true;treesLag=1;kick();
  }
  function start(route){
    sim.start(route);freeYaw=freePitch=0;holdingOrbit=false;simLag=0;ride=null;photo=paused=false;active=true;camHeading=sim.heading;snap=true;treesLag=1;lastUI=0;prev=0;
    input.steer=0;input.boost=input.brake=false;fx.reset();updateAvatar(0);moveCamera(0);refreshLOD();kick();
  }
  function beginRide(){
    const side=sim.route.destination||sim.route.resort,id=side==='genting'?'w469393391':'w1368988315';
    const lift=lifts.find(l=>l.meta.id===id);
    ride={lift,t:.006,look:.14,pitch:0};sim.mode='lift';sim.speed=0;paused=photo=false;snap=true;treesLag=1;return side;
  }
  function leaveRide(){const side=ride?.lift.meta.resort||sim.route.resort;ride=null;start(data.routes.find(r=>r.id===side+'-classic'));onEvent('disembark',side);}
  let adaptiveTime=0,adaptiveFrames=0;
  function loop(now){
    frame=0;if(!active)return;
    const raw=prev?(now-prev)/1000:1/60;const dt=Math.min(Math.max(raw,0),.085);prev=now;
    if(!paused&&!photo){
      clock+=dt;
      if(ride){
        ride.t=Math.min(.997,ride.t+dt*5.9/ride.lift.distance);
        const eye=ride.lift.seatAt(ride.t);sim.x=eye.x;sim.z=eye.z;sim.y=eye.y;
        if(ride.t>=.997)leaveRide();
      }else if(sim.mode==='run'){
        simLag+=dt;while(simLag>=1/90){sim.tick(1/90,input);simLag-=1/90;}
        if(sim.mode==='finished')onEvent('finish',sim);
      }
      for(const l of lifts)if(l.group.visible)l.update(clock,camera,ride?.lift===l ? ride.t : null);
      updateAvatar(dt);fx.update(sim,dt,opts.env,camera.position);
    }else if(photo)updateAvatar(0);
    moveCamera(dt);
    treesLag+=dt;if(treesLag>.40){refreshLOD();treesLag=0;}
    renderer.render(scene,camera);
    if(now-lastUI>95){onEvent('hud',sim);lastUI=now;}
    if(!paused&&!photo&&raw>0&&opts.quality==='auto'){
      adaptiveTime+=raw;adaptiveFrames++;
      if(adaptiveFrames>=55){if(adaptiveTime/adaptiveFrames>.041&&graphicsScale>.68){graphicsScale=Math.max(.67,graphicsScale-.12);resize();}adaptiveTime=adaptiveFrames=0;}
    }
    if(!paused&&!photo)kick();
  }
  function kick(){if(!frame&&active)frame=requestAnimationFrame(loop);}
  el.addEventListener('webglcontextlost',e=>{e.preventDefault();active=false;onEvent('lost');});
  return {
    sim,input,start,beginRide,leaveRide,
    pause(b){paused=b;input.steer=0;input.brake=input.boost=false;prev=0;kick();},
    stop(){active=false;paused=false;photo=false;ride=null;if(frame)cancelAnimationFrame(frame);frame=0;sim.mode='idle';},
    environment(){environment();kick();},graphics(){graphicsScale=1;sun.castShadow=opts.quality!=='lite';resize();treesLag=1;kick();},
    changeRider(){scene.remove(rider.group);rider.dispose();rider=createRider(opts);scene.add(rider.group);sim.gear=opts.gear;updateAvatar(0);kick();},
    cameraChanged(){snap=true;updateAvatar(0);kick();},
    photo(b,kind='rider'){photo=b;if(b)setPhotoPlace(kind);snap=true;prev=0;kick();},
    photoPlace:setPhotoPlace,
    orbit(dx,dy){if(photo){orbitYaw-=dx*.006;orbitPitch=clamp(orbitPitch+dy*.006,-.22,1.35);snap=true;kick();}else if(ride){ride.look-=dx*.007;ride.pitch=clamp(ride.pitch+dy*.005,-.7,.6);}else{holdingOrbit=true;freeYaw-=dx*.007;freePitch=clamp(freePitch+dy*.005,-.55,.78);}},
    releaseOrbit(){holdingOrbit=false;},
    zoom(d){orbitZoom=clamp(orbitZoom*d,photoSite?9:2.4,photoSite?260:26);snap=true;kick();},
    capture(){renderer.render(scene,camera);return new Promise(resolve=>el.toBlob(resolve,'image/png'));},
    get liftInfo(){return ride?{name:ride.lift.meta.name,resort:ride.lift.meta.resort,progress:ride.t}:null;}
  };
}
