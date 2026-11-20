import * as THREE from 'three';
import {createRider} from './rider.js';
import {createLandmark,createLift,setResortNight} from './resort.js';
import {Descent} from './simulation.js';
import {createSky,buildSurface,plantForest} from './landscape.js';
import {createMountainClimate} from './environment.js';
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
  let photoSite=null,station=null,stationYaw=0,stationPitch=0;
  const photoPan=new THREE.Vector3(),right=new THREE.Vector3(),forward=new THREE.Vector3();
  const climate=createMountainClimate();
  let conditions,climateAge=1;
  let freeYaw=0,freePitch=0,holdingOrbit=false;
  const input={steer:0,trim:0,brake:false,boost:false};
  const host=el.parentElement;
  function resize(){
    const width=host.clientWidth||innerWidth,height=host.clientHeight||innerHeight;
    const maxDpr=opts.quality==='lite'?1:opts.quality==='high'?1.8:1.4;
    renderer.setPixelRatio(Math.min(devicePixelRatio||1,maxDpr)*graphicsScale);renderer.setSize(width,height,false);
    camera.aspect=width/height;camera.updateProjectionMatrix();kick();
  }
  const observer=new ResizeObserver(resize);observer.observe(host);resize();
  function environment(){
    conditions=climate.sample(opts.time,opts.weather,clock);
    const e=conditions;
    sky.apply(e);forest.setLight(e);surface.setLight(e);setResortNight(e.lampAmount);
    scene.fog.color.set(e.fog);scene.fog.density=e.density;sun.color.set(e.sun);sun.intensity=e.light;
    hemi.intensity=e.ambient;hemi.color.set(e.hemi);hemi.groundColor.set(e.ground);source.fromArray(e.dir).normalize();
    renderer.toneMappingExposure=e.exposure;
  }
  environment();
  function updateAvatar(dt){
    const p=sim;
    rider.group.visible=!ride && (!!station||photo||opts.view!=='first');
    const tipsOnly=opts.view==='tips'&&!photo&&!station;
    for(const child of rider.group.children)child.visible=!tipsOnly||/^(Left ski|Right ski|Snowboard)$/.test(child.name);
    rider.group.position.set(p.x,p.y+.004,p.z);
    surfNorm.set((data.height(p.x-2,p.z)-data.height(p.x+2,p.z))/4,1,(data.height(p.x,p.z-2)-data.height(p.x,p.z+2))/4).normalize();
    if(p.airHeight>.1)surfNorm.lerp(up,clamp(p.airHeight*.8,0,1)).normalize();
    tiltQ.setFromUnitVectors(up,surfNorm);yawQ.setFromAxisAngle(up,-p.heading);tiltQ.multiply(yawQ);
    if(snap)rider.group.quaternion.copy(tiltQ);else rider.group.quaternion.slerp(tiltQ,1-Math.exp(-dt*32));
    rider.update(p,dt,clock);
  }
  function moveCamera(dt){
    const p=sim,mode=opts.view;
    const smoothing=snap?1:1-Math.exp(-dt*6.5);
    const travelHeading=p.travelHeading??p.heading;
    camHeading=snap?travelHeading:mixAngle(camHeading,travelHeading,1-Math.exp(-dt*4.6));
    if(!holdingOrbit){freeYaw*=Math.exp(-dt*4);freePitch*=Math.exp(-dt*4);}
    const a=camHeading+(photo||ride?0:freeYaw),fx=Math.sin(a),fz=-Math.cos(a),rx=-fz,rz=fx;
    const dx=(back,side)=>p.x-fx*back+rx*side,dz=(back,side)=>p.z-fz*back+rz*side;
    let fov=61;
    if(photo){
      const focus=photoSite?.focus;
      const theta=photoSite ? -photoSite.yaw+orbitYaw : a+orbitYaw;
      const reach=orbitZoom*Math.cos(orbitPitch);
      look.set(focus?.x??p.x,focus?.y??(p.y+.96),focus?.z??p.z).add(photoPan);
      want.set(look.x-Math.sin(theta)*reach,look.y+.32+Math.sin(orbitPitch)*orbitZoom,look.z+Math.cos(theta)*reach);
      want.y=Math.max(want.y,data.height(want.x,want.z)+.4);fov=52;
    }else if(ride){
      const {position:eye,direction}=ride.lift.getRide(ride.t,ride.dir);
      const h=ride.look+Math.atan2(direction.x,-direction.z);want.copy(eye).addScaledVector(up,.28);
      look.set(eye.x+Math.sin(h)*17,eye.y+1+ride.pitch*12,eye.z-Math.cos(h)*17);fov=73;
    }else if(station){
      const home=station.eye,aim=station.target;
      const co=Math.cos(stationYaw),si=Math.sin(stationYaw);
      const pivot=station.view==='wide'?p:station.view==='valley'?home:aim;
      function rotate(v,out){
        const ex=v.x-pivot.x,ez=v.z-pivot.z;
        out.set(pivot.x+ex*co+ez*si,v.y,pivot.z-ex*si+ez*co);
      }
      rotate(home,want);rotate(aim,look);
      want.y=Math.max(want.y,data.height(want.x,want.z)+.7);
      look.y+=Math.tan(stationPitch)*Math.hypot(look.x-want.x,look.z-want.z);
      fov=station.fov;
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
    camera.up.copy(up);camera.lookAt(target);if(!photo&&!ride&&!station&&Math.abs(freePitch)>.001)camera.rotateX(freePitch);if(Math.abs(camera.fov-fov)>.06){camera.fov=fov;camera.updateProjectionMatrix();}
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
      if(photo&&l.group.visible)l.update(clock,camera,ride?.lift===l?ride.t:null,ride?.dir);
    }
    for(const g of landmarks)g.visible=Math.hypot(g.position.x-camera.position.x,g.position.z-camera.position.z)<(opts.quality==='lite'?1800:3400);
  }
  function setPhotoPlace(kind){
    const side=station?.side||ride?.lift.meta.resort||(sim.mode==='finished'?sim.route.destination:
      (['wanlong','genting'].includes(sim.trail?.resort)?sim.trail.resort:sim.route.resort));
    photoPan.set(0,0,0);photoSite=photoPlaces.get(side+'-'+kind)||null;orbitYaw=photoSite?.kind==='hall'?-.13:0;
    orbitZoom=photoSite?.distance||5.9;orbitPitch=photoSite?.kind==='hall'?.13:.15;snap=true;treesLag=1;kick();
  }
  function resetScene(route){
    sim.start(route);station=null;ride=null;photo=paused=false;active=true;holdingOrbit=false;
    freeYaw=freePitch=simLag=0;snap=true;treesLag=1;lastUI=prev=0;
    input.trim=input.steer=0;input.boost=input.brake=false;fx.reset();
  }
  function showScene(){updateAvatar(0);moveCamera(0);refreshLOD();kick();}
  function start(route){resetScene(route);details.setRoute(route);showScene();}
  function point(xz,height){return new THREE.Vector3(xz[0],data.height(...xz)+height,xz[1]);}
  function stationPortrait(lift,end){
    const at=end==='top'?lift.meta.points.at(-1):lift.meta.points[0];
    const adj=end==='top'?lift.meta.points.at(-2):lift.meta.points[1];
    const dx=adj[0]-at[0],dz=adj[1]-at[1],angle=Math.atan2(dx,dz);
    const focus=point(at,3.5);
    let best=null,bestScore=-Infinity;
    // Place the camera on the apron, with an unobstructed view past nearby buildings.
    for(const offset of [-1.03,1.03,-.70,.70,-1.37,1.37,-.35,.35,-2.12,2.12,2.72,0]){
      const ax=Math.sin(angle+offset),az=Math.cos(angle+offset);
      const eye=point([at[0]+ax*26,at[1]+az*26],4.4);
      let score=-Math.abs(Math.abs(offset)-1.03)*.45-Math.abs(eye.y-focus.y)*.045;
      for(let n=0;n<12;n++){
        const f=n/12,x=eye.x+(focus.x-eye.x)*f,z=eye.z+(focus.z-eye.z)*f,y=eye.y+(focus.y-eye.y)*f;
        if(data.obstacles.contact(x,z)||data.height(x,z)+.45>y)score-=10;
      }
      if(score>bestScore){bestScore=score;best=eye;}
    }
    return {eye:best,target:focus};
  }
  function stopAt(route,place,side,lift,end,summit){
    resetScene(route);details.setRoute(null);
    sim.mode=summit?'summit':'station';sim.speed=sim.maxSpeed=sim.elapsed=sim.travel=sim.along=0;
    [sim.x,sim.z]=place.position;sim.heading=sim.travelHeading=place.heading;
    sim.ground=sim.startY=sim.y=data.height(sim.x,sim.z);
    sim.trail=null;sim.onTrail=false;
    station={side,lift,end,summit,eye:point(place.camera.position,place.camera.height),
      target:point(place.camera.target,place.camera.targetHeight),fov:place.camera.fov||58};
    station.homeEye=station.eye.clone();station.homeTarget=station.target.clone();station.view='wide';
    stationYaw=stationPitch=0;showScene();
  }
  function stage(route){
    const side=route.resort,place=data.summitPlaces[side];
    stopAt(route,place,side,lifts.find(l=>l.meta.id===place.liftId),place.stationEnd,true);
  }
  function trailhead(route){
    const f=route.frame(0),eye=[f.x-f.dx*6.4,f.z-f.dz*6.4],aim=[f.x+f.dx*10,f.z+f.dz*10];
    stopAt(route,{position:[f.x,f.z],heading:f.angle,camera:{position:eye,height:2.4,target:aim,targetHeight:1.4}},
      route.resort,null,null,false);
    station.trailhead=true;sim.mode='trailhead';
  }
  function nearestStation(){
    if(station?.lift)return {lift:station.lift,end:station.end};
    if(ride||!sim.route)return null;
    if(sim.mode==='finished'){
      const side=sim.route.destination;
      return {lift:lifts.find(l=>l.meta.id===(side==='genting'?'w469393391':'w1368988315')),end:'bottom'};
    }
    let nearest=null,min=48;
    for(const lift of lifts){
      for(const end of ['bottom','top']){
        const [x,z]=end==='top'?lift.meta.points.at(-1):lift.meta.points[0];
        const distance=Math.hypot(x-sim.x,z-sim.z);
        if(distance<min){nearest={lift,end};min=distance;}
      }
    }
    return nearest;
  }
  function beginRide(){
    const here=nearestStation();if(!here)return false;
    const {lift,end}=here,dir=end==='top'?-1:1;
    station=null;ride={lift,dir,t:dir>0?.004:.996,look:.09,pitch:0};sim.mode='lift';sim.speed=0;
    const eye=lift.seatAt(ride.t,dir);sim.x=eye.x;sim.z=eye.z;sim.y=eye.y;
    paused=photo=false;snap=true;treesLag=1;prev=0;kick();return true;
  }
  function leaveRide(){
    if(!ride)return;
    const {lift,dir}=ride,side=lift.meta.resort,place=data.summitPlaces[side],end=dir>0?'top':'bottom';
    const route=data.routes.find(r=>r.id===side+'-classic');
    const at=end==='top'?lift.meta.points.at(-1):lift.meta.points[0];
    if(end==='top' && (lift.meta.id===place.liftId || Math.hypot(at[0]-place.position[0],at[1]-place.position[1])<190)){
      stage(route);
    }else{
      const near=end==='top'?lift.meta.points.at(-2):lift.meta.points[1];
      const len=Math.hypot(near[0]-at[0],near[1]-at[1])||1;
      const ax=(near[0]-at[0])/len,az=(near[1]-at[1])/len;
      const stand=[at[0]+az*14+ax*6,at[1]-ax*14+az*6];
      const eye=[stand[0]+az*5+ax*3,stand[1]-ax*5+az*3];
      const aim=[at[0]+ax*5,at[1]+az*5];
      stopAt(route,{position:stand,heading:Math.atan2(aim[0]-stand[0],stand[1]-aim[1]),
        camera:{position:eye,height:2.6,target:aim,targetHeight:2.3,fov:64}},side,lift,end,false);
    }
    onEvent('disembark',{side,route,mode:sim.mode,end});
  }
  let adaptiveTime=0,adaptiveFrames=0;
  function loop(now){
    frame=0;if(!active)return;
    const raw=prev?(now-prev)/1000:1/60;const dt=Math.min(Math.max(raw,0),.085);prev=now;
    if(!paused&&!photo){
      clock+=dt;climateAge+=dt;
      if(climateAge>.15){environment();climateAge=0;}
      if(ride){
        ride.t=clamp(ride.t+dt*ride.dir*ride.lift.speed/ride.lift.length,.003,.997);
        const eye=ride.lift.seatAt(ride.t,ride.dir);sim.x=eye.x;sim.z=eye.z;sim.y=eye.y;
        if(ride.dir>0?ride.t>=.997:ride.t<=.003)leaveRide();
      }else if(sim.mode==='run'){
        details.setRoute(sim.route);
        simLag+=dt;while(simLag>=1/90){sim.tick(1/90,input);simLag-=1/90;}
        if(sim.mode==='finished')onEvent('finish',sim);
      }
      for(const l of lifts)if(l.group.visible)l.update(clock,camera,ride?.lift===l ? ride.t : null,ride?.dir);
      updateAvatar(dt);fx.update(sim,dt,conditions,camera.position);
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
    sim,input,start,stage,trailhead,beginRide,leaveRide,
    lookAroundStation(view){
      if(!station)return;
      station.view=view;const side=station.side;
      if(view==='wide'){station.eye.copy(station.homeEye);station.target.copy(station.homeTarget);}
      else if(view==='valley'){
        const top=data.summitPlaces[side],hall=data.landmarks.find(l=>l.id===side+'-hall');
        const eye=point(top.position,14),dx=hall.x-eye.x,dz=hall.z-eye.z,d=Math.hypot(dx,dz);
        station.eye.copy(eye);station.target.set(eye.x+dx/d*310,eye.y-45,eye.z+dz/d*310);
      }else if(view==='lodge'){
        const shot=photoPlaces.get(side+'-lodge');
        station.target.copy(shot.focus);station.eye.copy(shot.focus);
        station.eye.x+=Math.sin(shot.yaw)*shot.distance;station.eye.z+=Math.cos(shot.yaw)*shot.distance;
        station.eye.y=Math.max(shot.focus.y+4,data.height(station.eye.x,station.eye.z)+3.3);
      }else{
        const shot=stationPortrait(station.lift,station.end);
        station.eye.copy(shot.eye);station.target.copy(shot.target);
      }
      stationYaw=stationPitch=0;snap=true;treesLag=1;kick();
    },
    get nextFlag(){return details.nextFlag(sim.along);},
    get conditions(){return conditions;},
    get station(){return station;},
    get nearbyStation(){const n=nearestStation();return n?{name:n.lift.meta.name,end:n.end}:null;},
    pause(b){paused=b;input.trim=input.steer=0;input.brake=input.boost=false;prev=0;kick();},
    stop(){active=false;paused=false;photo=false;ride=station=null;if(frame)cancelAnimationFrame(frame);frame=0;sim.mode='idle';},
    environment(){environment();kick();},graphics(){graphicsScale=1;sun.castShadow=opts.quality!=='lite';resize();treesLag=1;kick();},
    changeRider(){scene.remove(rider.group);rider.dispose();rider=createRider(opts);scene.add(rider.group);sim.gear=opts.gear;updateAvatar(0);kick();},
    cameraChanged(){snap=true;updateAvatar(0);kick();},
    photo(b,kind='rider'){photo=b;if(b)setPhotoPlace(kind);snap=true;prev=0;kick();},
    photoPlace:setPhotoPlace,
    orbit(dx,dy){if(photo){orbitYaw-=dx*.006;orbitPitch=clamp(orbitPitch+dy*.006,-.22,1.35);snap=true;kick();}else if(ride){ride.look-=dx*.007;ride.pitch=clamp(ride.pitch+dy*.005,-.7,.6);}else if(station){stationYaw+=dx*.006;stationPitch=clamp(stationPitch+dy*.005,-.65,.72);kick();}else{holdingOrbit=true;freeYaw-=dx*.007;freePitch=clamp(freePitch+dy*.005,-.55,.78);}},
    panPhoto(dx,dy,elevation=0){
      if(!photo)return;
      const scale=orbitZoom*.0026;
      right.set(1,0,0).applyQuaternion(camera.quaternion);right.y=0;right.normalize();
      camera.getWorldDirection(forward);forward.y=0;forward.normalize();
      photoPan.addScaledVector(right,-dx*scale).addScaledVector(forward,dy*scale);
      photoPan.y=clamp(photoPan.y+elevation,-100,220);snap=true;treesLag=1;kick();
    },
    releaseOrbit(){holdingOrbit=false;},
    zoom(d){orbitZoom=clamp(orbitZoom*d,photoSite?9:2.4,photoSite?360:180);snap=true;kick();},
    capture(){renderer.render(scene,camera);return new Promise(resolve=>el.toBlob(resolve,'image/png'));},
    get liftInfo(){return ride?{name:ride.lift.meta.name,resort:ride.lift.meta.resort,progress:ride.dir>0?ride.t:1-ride.t,dir:ride.dir,speed:ride.lift.speed}:null;}
  };
}
