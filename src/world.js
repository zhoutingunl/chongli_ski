import {nearbyLiftStation} from './lift-access.js';
import {placeLiftSupports} from './lift-supports.js';
import * as THREE from 'three';
import {createRider} from './rider.js';
import {createLandmark,createLift,setResortNight} from './resort.js';
import {Descent} from './simulation.js';
import {createSkiNavigation} from './navigation.js';
import {createSky,buildSurface,plantForest} from './landscape.js';
import {createMountainClimate} from './environment.js';
import {courseDetails,makeSnowFX} from './details.js';
import {createTrailGuide} from './trail-guide.js';
import {clamp,mixAngle} from './mountain.js';
import {isMiniTool} from './platform.js';

const up=new THREE.Vector3(0,1,0);
export async function createWorld(el,data,opts,onEvent,onProgress=()=>{},climate=createMountainClimate()) {
  const renderer=new THREE.WebGLRenderer({canvas:el,antialias:!isMiniTool,alpha:false,powerPreference:isMiniTool?'default':'high-performance',stencil:false});
  renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.02;
  renderer.shadowMap.enabled=!isMiniTool;renderer.shadowMap.type=THREE.PCFShadowMap;
  let shaderFailure=false;
  if(isMiniTool)renderer.debug.onShaderError=()=>{shaderFailure=true;};
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
    const points=placeLiftSupports(lift.points,data).map(([x,z])=>new THREE.Vector3(x,data.height(x,z),z));
    const obj=createLift({...lift,type:lift.kind,points,validatedSupports:true,heightAt:data.height});
    scene.add(obj.group);
    const distance=points.reduce((sum,p,i)=>i?sum+p.distanceTo(points[i-1]):0,0);
    const center=points[0].clone().lerp(points.at(-1),.5);
    const casters=[];obj.group.traverse(child=>{if(child.isMesh&&child.castShadow)casters.push(child);});
    lifts.push({...obj,meta:lift,distance,center,casters,radius:points[0].distanceTo(points.at(-1))*.5+200});
  }
  const navigation=createSkiNavigation(data);
  const details=courseDetails(scene,data,navigation);
  const trailGuide=createTrailGuide(scene,data,renderer);
  const fx=makeSnowFX(scene,data);
  let rider=createRider(opts);scene.add(rider.group);
  const sim=new Descent(data,opts,rider.dimensions);
  const yawQ=new THREE.Quaternion(),tiltQ=new THREE.Quaternion(),surfNorm=new THREE.Vector3(),want=new THREE.Vector3(),look=new THREE.Vector3(),target=new THREE.Vector3();
  let active=false,paused=false,photo=false,orbitYaw=0,orbitPitch=.10,orbitZoom=5.9,ride=null,clock=0,prev=0,lastUI=0,simLag=0,treesLag=1,camHeading=0,snap=true,frame=0,graphicsScale=1;
  let photoSite=null,station=null,baseTurn=null;
  const photoPan=new THREE.Vector3(),right=new THREE.Vector3(),forward=new THREE.Vector3();
  let conditions,climateAge=1;
  const bodyOrigin=new THREE.Vector3(),lastOrigin=new THREE.Vector3(),bodyStep=new THREE.Vector3();
  const eyeOffset=new THREE.Vector3(),tipWorld=new THREE.Vector3(),sight=new THREE.Vector3(),orbitPivot=new THREE.Vector3();
  const reducedMotion=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const pitchLimit=THREE.MathUtils.degToRad(85);
  let lookYaw=0,lookPitch=0,headPitch=0,roll=0,baseBearing=0;
  const input={steer:0,trim:0,brake:false,boost:false,lookX:0,lookY:0};
  const wrap=angle=>Math.atan2(Math.sin(angle),Math.cos(angle));
  function resetLook(){lookYaw=lookPitch=0;input.lookX=input.lookY=0;}
  function panLook(yaw,pitch){
    if(baseTurn){baseTurn.target+=yaw;baseTurn.focus=null;}
    else lookYaw=wrap(lookYaw+yaw);
    lookPitch=clamp(lookPitch+pitch,-2.57,2.57);
    if(station)station.preset=false;
  }
  function parkFacing(facing,home=facing){
    const {x,z}=sim;
    baseTurn={yaw:facing,target:facing,home,focus:null,entryOffset:wrap(sim.heading-facing),
      gradeX:(data.height(x+2,z)-data.height(x-2,z))/4,gradeZ:(data.height(x,z+2)-data.height(x,z-2))/4};
    lookYaw=0;
    sim.travelHeading=camHeading=wrap(facing);
    sim.pivotRate=0;
  }
  function turnInPlace(dt){
    if(input.lookX||input.lookY)panLook(input.lookX*dt*1.95,input.lookY*dt*1.38);
    const error=baseTurn.target-baseTurn.yaw;
    const ease=-Math.expm1(-dt*12),step=clamp(error*ease,-6*dt,6*dt);
    const align=clamp(-baseTurn.entryOffset*ease,-6*dt,6*dt);
    baseTurn.yaw+=step;
    baseTurn.entryOffset+=align;
    sim.travelHeading=camHeading=wrap(baseTurn.yaw);
    sim.heading=wrap(baseTurn.yaw+baseTurn.entryOffset);
    sim.pivotRate=dt>0?(step+align)/dt:0;
    const fx=Math.sin(sim.heading),fz=-Math.cos(sim.heading);
    sim.slope=THREE.MathUtils.radToDeg(Math.atan(-baseTurn.gradeX*fx-baseTurn.gradeZ*fz));
    sim.roll=Math.atan(-baseTurn.gradeX*fz+baseTurn.gradeZ*fx);
  }
  const host=el.parentElement;
  function resize(){
    const width=host.clientWidth||innerWidth,height=host.clientHeight||innerHeight;
    const maxDpr=opts.quality==='lite'?1:opts.quality==='high'?1.8:1.4;
    const pixelLimit=isMiniTool?Math.sqrt(2000000/(width*height)):Infinity;
    renderer.setPixelRatio(Math.min(devicePixelRatio||1,maxDpr,isMiniTool?1.35:Infinity,pixelLimit)*graphicsScale);
    renderer.setSize(width,height,false);
    camera.aspect=width/height;camera.updateProjectionMatrix();kick();
  }
  const observer=new ResizeObserver(resize);observer.observe(host);resize();
  function environment(){
    conditions=climate.sample(opts.time,opts.weather);
    const e=conditions;
    sky.apply(e);forest.setLight(e);surface.setLight(e);setResortNight(e.lampAmount);
    scene.fog.color.set(e.fog);scene.fog.density=e.density*(.69+.31*e.snowAmount);sun.color.set(e.sun);sun.intensity=e.light;
    hemi.intensity=e.ambient;hemi.color.set(e.hemi);hemi.groundColor.set(e.ground);source.fromArray(e.dir).normalize();
    renderer.toneMappingExposure=e.exposure;
  }
  environment();
  function updateAvatar(dt){
    const p=sim;
    rider.group.visible=!ride;
    const embodied=!photo && (!station || station.view==='wide' || opts.view==='first');
    rider.setVisibility(embodied&&opts.view==='first'?'first':embodied&&opts.view==='tips'?'tips':'body');
    rider.group.position.set(p.x,p.y+.004-p.snowSink,p.z);
    surfNorm.set((data.height(p.x-2,p.z)-data.height(p.x+2,p.z))/4,1,(data.height(p.x,p.z-2)-data.height(p.x,p.z+2))/4).normalize();
    if(p.airHeight>.1)surfNorm.lerp(up,clamp(p.airHeight*.8,0,1)).normalize();
    tiltQ.setFromUnitVectors(up,surfNorm);yawQ.setFromAxisAngle(up,-p.heading);tiltQ.multiply(yawQ);
    if(snap||baseTurn)rider.group.quaternion.copy(tiltQ);else rider.group.quaternion.slerp(tiltQ,1-Math.exp(-dt*32));
    rider.update(p,dt,clock);
    surface.setRiderShadow(!ride&&(!renderer.shadowMap.enabled||!sun.castShadow||opts.view==='first'||opts.view==='tips')?rider:null);
  }
  function moveCamera(dt){
    const p=sim,mode=opts.view,run=p.mode==='run';
    const bodyScale=rider.dimensions.scale;
    const travel=p.travelHeading??p.heading,fast=clamp(p.speed/22,0,1);
    const first=mode==='first'&&!photo&&!ride;
    const tips=mode==='tips'&&!photo&&!ride&&(!station||station.view==='wide');
    const cameraEase=snap?1:1-Math.exp(-dt*8);
    const pitchEase=snap?1:1-Math.exp(-dt*7.5);
    camHeading=snap?travel:mixAngle(camHeading,travel,1-Math.exp(-dt*(first?6:4.8)));
    bodyOrigin.set(p.x,p.y,p.z);bodyStep.copy(bodyOrigin).sub(lastOrigin);lastOrigin.copy(bodyOrigin);
    if(!baseTurn&&!paused&&!photo&&(input.lookX||input.lookY))panLook(input.lookX*dt*1.95,input.lookY*dt*1.38);
    let fov=61,bank=0,addPitch=0,heading=camHeading,lockEye=false;
    if(photo){
      const focus=photoSite?.focus,theta=photoSite ? -photoSite.yaw+orbitYaw : travel+orbitYaw;
      const reach=orbitZoom*Math.cos(orbitPitch);
      look.set(focus?.x??p.x,focus?.y??(p.y-p.snowSink+.96*bodyScale),focus?.z??p.z).add(photoPan);
      want.set(look.x-Math.sin(theta)*reach,look.y+.32+Math.sin(orbitPitch)*orbitZoom,look.z+Math.cos(theta)*reach);
      want.y=Math.max(want.y,data.height(want.x,want.z)+.30);fov=52;
    }else if(ride){
      const {position:eye,direction}=ride.lift.getRide(ride.t,ride.dir);
      want.copy(eye);want.y+=.28;heading=Math.atan2(direction.x,-direction.z)+ride.look;
      baseBearing=heading;heading+=lookYaw;
      look.set(want.x+Math.sin(heading)*18,want.y+.6,want.z-Math.cos(heading)*18);
      addPitch=lookPitch;fov=73;lockEye=true;
    }else if(first||tips){
      // The horizon follows the line of travel. The eye itself follows the rider's
      // changing stance, so a tuck brings the snow closer without delaying road motion.
      if(first){
        rider.group.localToWorld(rider.eyePosition(want));want.sub(bodyOrigin);
        if(snap)eyeOffset.copy(want);else eyeOffset.lerp(want,1-Math.exp(-dt*(reducedMotion?7:17)));
        want.copy(bodyOrigin).add(eyeOffset);
      }else{
        const back=.15*rider.dimensions.lengthScale;
        want.set(p.x-back*Math.sin(travel),p.y-p.snowSink+.90*bodyScale,p.z+back*Math.cos(travel));
      }
      fov=tips?76:station?71:72+(reducedMotion?2:15)*fast+Math.min(2,p.boost*fast*2);
      const grade=THREE.MathUtils.degToRad(p.slope||0);
      let neutral=station?station.restPitch:-.16-.70*grade;
      if(tips)neutral=-.57-.68*grade;
      else if(run){
        rider.group.localToWorld(rider.tipPosition(tipWorld));
        const toTip=tipWorld.sub(want);
        const tipDepth=toTip.x*Math.sin(camHeading)-toTip.z*Math.cos(camHeading);
        const tipPitch=Math.atan2(toTip.y,tipDepth);
        const tipAtBottom=tipPitch+Math.atan(.85*Math.tan(THREE.MathUtils.degToRad(fov*.5)));
        neutral=clamp(Math.min(neutral,tipAtBottom)-.030*(p.trim||0),-1.25,-.08);
        if(!reducedMotion)neutral+=.023*(p.launch||0)-.045*(p.landing||0);
      }
      headPitch+= (neutral-headPitch)*pitchEase;
      baseBearing=camHeading+(run?.11*(p.slipAngle||0):0);
      heading=baseBearing+lookYaw;
      look.set(want.x+Math.sin(heading)*20,want.y+Math.tan(headPitch)*20,want.z-Math.cos(heading)*20);
      bank=run&&!reducedMotion?clamp((p.edge||0)*.080+(p.curve||0)*fast*.033,-.115,.115):0;
      addPitch=lookPitch;lockEye=true;
    }else if(station&&!baseTurn){
      const eye=station.eye,aim=station.target;
      const pivot=station.view==='wide'?bodyOrigin:station.view==='valley'?eye:aim;
      const co=Math.cos(lookYaw),si=Math.sin(lookYaw);
      function rotate(v,out){
        const ex=v.x-pivot.x,ez=v.z-pivot.z;
        out.set(pivot.x+ex*co-ez*si,v.y,pivot.z+ex*si+ez*co);
      }
      rotate(eye,want);rotate(aim,look);
      want.y=Math.max(want.y,data.height(want.x,want.z)+.60);
      baseBearing=Math.atan2(aim.x-eye.x,eye.z-aim.z);
      addPitch=lookPitch;fov=station.fov;
    }else{
      // Rotate the rig around the skier. Keep the in-motion camera's smoothing
      // local to the rider, including during a rapid carve or a landing.
      heading=camHeading+lookYaw;
      const fx=Math.sin(heading),fz=-Math.cos(heading),rx=-fz,rz=fx;
      const dx=(back,side)=>p.x-fx*back+rx*side,dz=(back,side)=>p.z-fz*back+rz*side;
      let back=4.6+fast*1.25,side=0,lift=1.82+fast*.22,lead=4.8+fast*.7,eye=1.35;
      if(mode==='low'){back=3.25;lift=.38;lead=3;eye=1.02;fov=70;}
      if(mode==='top'){back=1.65;lift=26;lead=.45;eye=0;fov=54;}
      if(mode==='left'||mode==='right'){back=1.8;side=mode==='right'?4.8:-4.8;lift=1.44;lead=.59;eye=.95;}
      if(mode==='front'){back=-4.3;side=.32;lift=1.48;lead=0;eye=1.01;}
      if(mode==='far'){back=15;side=4.4;lift=4.8;lead=3.4;eye=1.2;}
      if(mode==='follow'){
        back=3.55+fast*.62;lift=1.55+fast*.18;lead=3.8;eye=1.03;
        fov=57+(reducedMotion?1:4)*fast;
        if(run&&!reducedMotion)bank=clamp((p.curve||0)*fast*.062+(p.edge||0)*fast*.016,-.048,.048);
      }
      if(mode!=='top'&&mode!=='far'){
        const framing=.40+.60*bodyScale;
        back*=framing;side*=framing;lead*=framing;lift*=framing;eye*=bodyScale;
      }
      const x=dx(back,side),z=dz(back,side),aheadX=dx(-lead,0),aheadZ=dz(-lead,0);
      want.set(x,Math.max(p.y+lift,data.height(x,z)+lift),z);
      look.set(aheadX,p.y+eye+(data.height(aheadX,aheadZ)-p.ground)*.75,aheadZ);
      baseBearing=wrap(Math.atan2(look.x-want.x,want.z-look.z)-lookYaw);
      addPitch=lookPitch;
      if(!snap){camera.position.add(bodyStep);target.add(bodyStep);}
    }
    if(snap||lockEye||photo||baseTurn){camera.position.copy(want);target.copy(look);}
    else{camera.position.lerp(want,cameraEase);target.lerp(look,cameraEase);}
    if(!ride)camera.position.y=Math.max(camera.position.y,data.height(camera.position.x,camera.position.z)+.15);
    camera.up.copy(up);
    if(photo)camera.lookAt(target);
    else{
      sight.copy(target).sub(camera.position);
      const horizontal=Math.max(.001,Math.hypot(sight.x,sight.z));
      const basePitch=Math.atan2(sight.y,horizontal);
      if(baseTurn?.focus){
        orbitPivot.copy(baseTurn.focus).sub(camera.position);
        addPitch=Math.atan2(orbitPivot.y,Math.hypot(orbitPivot.x,orbitPivot.z))-basePitch;
      }
      const finalPitch=clamp(basePitch+addPitch,-pitchLimit,pitchLimit);
      // Discard excess input at a pole so one small reverse drag moves the view.
      lookPitch=finalPitch-basePitch;
      const azimuth=Math.atan2(sight.x,-sight.z),cos=Math.cos(finalPitch);
      sight.set(Math.sin(azimuth)*cos,Math.sin(finalPitch),-Math.cos(azimuth)*cos).add(camera.position);
      camera.lookAt(sight);
    }
    roll+=(bank-roll)*(snap?1:1-Math.exp(-dt*5));
    if((first||mode==='follow'&&!photo&&!ride)&&Math.abs(roll)>.0001)camera.rotateZ(roll);
    fov=snap?fov:camera.fov+(fov-camera.fov)*(1-Math.exp(-dt*7));
    if(Math.abs(camera.fov-fov)>.008){camera.fov=fov;camera.updateProjectionMatrix();}
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
    orbitZoom=photoSite?.distance||5.9*(.40+.60*rider.dimensions.scale);orbitPitch=photoSite?.kind==='hall'?.13:.15;snap=true;treesLag=1;kick();
  }
  function resetScene(route){
    sim.start(route);station=null;ride=null;photo=paused=false;active=true;resetLook();
    baseTurn=null;sim.pivotRate=0;
    simLag=0;snap=true;treesLag=1;lastUI=prev=0;
    input.trim=input.steer=0;input.boost=input.brake=false;fx.reset();
  }
  function showScene(){updateAvatar(0);moveCamera(0);refreshLOD();kick();}
  function start(route){route=navigation.safeRun(route);resetScene(route);climate.startRun(opts.time);environment();details.setRoute(route);showScene();}
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
    const ahead=data.height(sim.x+12*Math.sin(place.heading),sim.z-12*Math.cos(place.heading));
    const restPitch=summit?-.08-clamp(Math.atan2(sim.ground-ahead,12),0,.4):-.055;
    station={side,lift,end,summit,eye:point(place.camera.position,place.camera.height),
      target:point(place.camera.target,place.camera.targetHeight),fov:place.camera.fov||58,restPitch};
    station.homeEye=station.eye.clone();station.homeTarget=station.target.clone();station.view='wide';
    if(lift&&end==='bottom'&&!summit)parkFacing(place.heading);
    resetLook();showScene();
  }
  function stage(route){
    const side=route.resort,place=data.summitPlaces[side];
    stopAt(route,place,side,lifts.find(l=>l.meta.id===place.liftId),place.stationEnd,true);
  }
  function pushOff(turn=0,preferred,routeHeading){
    if(!station)return null;
    const poseHeading=baseTurn?sim.heading:wrap(baseBearing+lookYaw),requested=Number.isFinite(routeHeading)?routeHeading:wrap(poseHeading+turn);
    const facingFork=sim.junctions[0]?.index===0&&Math.abs(wrap(poseHeading-sim.heading))>.35;
    const route=station.trailhead&&!turn&&!facingFork?sim.route:navigation.departure(station.side,sim.x,sim.z,requested,preferred);
    if(!route)return null;
    const wasHead=opts.view==='first',oldPitch=headPitch,oldLookPitch=lookPitch;
    resetScene(route);climate.startRun(opts.time);environment();
    if(!Number.isFinite(routeHeading))sim.freeHeading(requested);
    sim.speed=sim.maxSpeed=2.15;sim.push=.75;
    details.setRoute(route);camHeading=poseHeading;headPitch=oldPitch;
    if(wasHead){snap=false;lookPitch=oldLookPitch;lastOrigin.set(sim.x,sim.y,sim.z);}
    showScene();return route;
  }
  function trailhead(route){
    route=navigation.safeRun(route);
    const f=route.frame(0),eye=[f.x-f.dx*6.4,f.z-f.dz*6.4],aim=[f.x+f.dx*10,f.z+f.dz*10];
    stopAt(route,{position:[f.x,f.z],heading:f.angle,camera:{position:eye,height:2.4,target:aim,targetHeight:1.4}},
      route.resort,null,null,false);
    station.trailhead=true;sim.mode='trailhead';
  }
  function nearestStation(){
    if(station?.lift)return {lift:station.lift,end:station.end};
    const nearby=nearbyLiftStation(data,sim);
    return nearby&&{lift:lifts.find(lift=>lift.meta.id===nearby.lift.id),end:nearby.end};
  }
  function beginRide(){
    const here=nearestStation();if(!here)return false;
    const {lift,end}=here,dir=end==='top'?-1:1;
    station=baseTurn=null;sim.pivotRate=0;resetLook();
    ride={lift,dir,t:dir>0?.004:.996,look:.09,pitch:0};sim.mode='lift';sim.speed=0;
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
      const stand=navigation.stationExit(lift.meta,end);
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
    if(document.hidden){prev=0;return;}
    if(isMiniTool&&prev&&!paused&&!photo&&now-prev<31){kick();return;}
    const raw=prev?(now-prev)/1000:1/60;const dt=Math.min(Math.max(raw,0),.085);prev=now;
    if(!paused&&!photo){
      clock+=dt;climateAge+=dt;climate.advance(dt,opts.time,opts.weather,sim.mode==='run');
      if(climateAge>.15){environment();climateAge=0;}
      if(ride){
        ride.t=clamp(ride.t+dt*ride.dir*ride.lift.speed/ride.lift.length,.003,.997);
        const eye=ride.lift.seatAt(ride.t,ride.dir);sim.x=eye.x;sim.z=eye.z;sim.y=eye.y;
        if(ride.dir>0?ride.t>=.997:ride.t<=.003)leaveRide();
      }else if(sim.mode==='run'){
        details.setRoute(sim.route);
        simLag+=dt;while(simLag>=1/90){sim.tick(1/90,input);simLag-=1/90;}
        if(sim.mode==='finished'){
          parkFacing(camHeading+lookYaw,sim.travelHeading);
          details.setRoute(null);onEvent('finish',sim);
        }
      }
      if(baseTurn)turnInPlace(dt);
      for(const l of lifts)if(l.group.visible)l.update(clock,camera,ride?.lift===l ? ride.t : null,ride?.dir);
      updateAvatar(dt);fx.update(sim,dt,conditions,camera.position,rider.dimensions);
    }else if(photo)updateAvatar(0);
    moveCamera(dt);
    treesLag+=dt;if(treesLag>.40){refreshLOD();treesLag=0;}
    trailGuide.update(sim,navigation,opts.language,camera);
    renderer.render(scene,camera);
    if(shaderFailure){active=false;onEvent('lost');return;}
    if(now-lastUI>95){onEvent('hud',sim);lastUI=now;}
    if(!paused&&!photo&&raw>0&&opts.quality==='auto'){
      adaptiveTime+=raw;adaptiveFrames++;
      if(adaptiveFrames>=55){
        const slow=adaptiveTime/adaptiveFrames>.045;
        if(slow&&graphicsScale>.68){graphicsScale=Math.max(.67,graphicsScale-.12);resize();}
        else if(slow&&isMiniTool){active=false;onEvent('lost');}
        adaptiveTime=adaptiveFrames=0;
      }
    }
    if(!paused&&!photo)kick();
  }
  function kick(){if(!frame&&active)frame=requestAnimationFrame(loop);}
  el.addEventListener('webglcontextlost',e=>{e.preventDefault();if(active){active=false;onEvent('lost');}});
  return {
    sim,input,start,stage,trailhead,pushOff,beginRide,leaveRide,
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
      resetLook();station.preset=view!=='wide';
      if(opts.view==='first'&&view!=='wide'){
        // Look towards the landmark from the standing rider's eyes.
        const at=view==='valley'?data.landmarks.find(l=>l.id===side+'-hall'):null;
        if(at)orbitPivot.set(at.x,data.height(at.x,at.z)+10,at.z);
        else orbitPivot.copy(station.target);
        const dx=orbitPivot.x-sim.x,dz=orbitPivot.z-sim.z;
        lookYaw=wrap(Math.atan2(dx,-dz)-sim.heading);
        const eyeY=rider.group.localToWorld(rider.eyePosition(want)).y;
        lookPitch=clamp(Math.atan2(orbitPivot.y-eyeY,Math.hypot(dx,dz))-station.restPitch,-pitchLimit,pitchLimit);
      }
      snap=true;treesLag=1;kick();
    },
    get nextFlag(){return details.nextFlag(sim.along);},
    get conditions(){return conditions;},
    get station(){return station;},
    recoverToPiste(){
      if(!sim.recoverToPiste())return false;
      resetLook();fx.reset();details.setRoute(sim.route);simLag=0;snap=true;treesLag=1;
      showScene();return true;
    },
    get nearbyStation(){const n=nearestStation();return n?{name:n.lift.meta.name,end:n.end}:null;},
    pause(b){paused=b;input.lookX=input.lookY=input.trim=input.steer=0;input.brake=input.boost=false;prev=0;kick();},
    stop(){active=false;paused=false;photo=false;ride=station=baseTurn=null;sim.pivotRate=0;if(frame)cancelAnimationFrame(frame);frame=0;sim.mode='idle';},
    environment(){environment();kick();},graphics(){graphicsScale=1;sun.castShadow=!isMiniTool&&opts.quality!=='lite';resize();treesLag=1;kick();},
    changeRider(){
      const previousScale=rider.dimensions.scale;
      scene.remove(rider.group);rider.dispose();rider=createRider(opts);scene.add(rider.group);
      sim.gear=opts.gear;sim.dimensions=rider.dimensions;
      if(previousScale!==rider.dimensions.scale)snap=true;
      updateAvatar(0);kick();
    },
    cameraChanged(){
      if(station){station.view='wide';station.preset=false;station.eye.copy(station.homeEye);station.target.copy(station.homeTarget);}
      if(baseTurn)baseTurn.focus=null;
      resetLook();snap=true;updateAvatar(0);kick();
    },
    lookAtBaseHall(){
      if(!baseTurn||sim.mode!=='finished')return;
      const hall=photoPlaces.get(sim.route.destination+'-hall');
      if(!hall)return;
      // Rotate the current camera rig with the skier. Its optical axis may
      // be off the centre of the skis, especially in a left or right view.
      camera.getWorldDirection(sight);
      const horizontal=Math.max(.001,Math.hypot(sight.x,sight.z)),fx=sight.x/horizontal,fz=sight.z/horizontal;
      const cx=camera.position.x-sim.x,cz=camera.position.z-sim.z;
      const tx=hall.focus.x-sim.x,tz=hall.focus.z-sim.z,along=cx*fx+cz*fz;
      const ray=-along+Math.sqrt(Math.max(0,along*along+tx*tx+tz*tz-cx*cx-cz*cz));
      const delta=wrap(Math.atan2(tx,-tz)-Math.atan2(cx+ray*fx,-cz-ray*fz));
      baseTurn.target=baseTurn.yaw+delta;baseTurn.focus=hall.focus;
      kick();
    },
    centerLook(){
      if(station&&station.view!=='wide'){this.lookAroundStation('wide');return;}
      if(baseTurn){baseTurn.target=baseTurn.yaw+wrap(baseTurn.home-baseTurn.yaw);baseTurn.focus=null;}
      resetLook();kick();
    },
    get looking(){const yaw=baseTurn?wrap(baseTurn.yaw-baseTurn.home):lookYaw;return Math.abs(yaw)>.035 || Math.abs(lookPitch)>.035 || !!station?.preset;},
    get facing(){return wrap(baseBearing+lookYaw);},
    pushTowardsView(){
      camHeading=this.facing;sim.freeHeading(camHeading);resetLook();kick();
    },
    summitHeading(routeId){return station?.summit?navigation.summitHeading(station.side,routeId):undefined;},
    photo(b,kind='rider'){photo=b;if(b)setPhotoPlace(kind);snap=true;prev=0;kick();},
    photoPlace:setPhotoPlace,
    orbit(dx,dy){
      const yawPerPixel=Math.PI/Math.max(170,Math.min(host.clientWidth*.46,390));
      if(photo){orbitYaw=wrap(orbitYaw-dx*yawPerPixel);orbitPitch=clamp(orbitPitch+dy*yawPerPixel,-1.46,1.49);snap=true;}
      else panLook(-dx*yawPerPixel,dy*yawPerPixel*.87);
      kick();
    },
    panPhoto(dx,dy,elevation=0){
      if(!photo)return;
      const scale=orbitZoom*.0026;
      right.set(1,0,0).applyQuaternion(camera.quaternion);right.y=0;right.normalize();
      camera.getWorldDirection(forward);forward.y=0;forward.normalize();
      photoPan.addScaledVector(right,-dx*scale).addScaledVector(forward,dy*scale);
      photoPan.y=clamp(photoPan.y+elevation,-100,220);snap=true;treesLag=1;kick();
    },
    zoom(d){orbitZoom=clamp(orbitZoom*d,photoSite?9:2.4,photoSite?360:180);snap=true;kick();},
    capture(){renderer.render(scene,camera);return new Promise(resolve=>el.toBlob(resolve,'image/png'));},
    get liftInfo(){return ride?{name:ride.lift.meta.name,resort:ride.lift.meta.resort,progress:ride.dir>0?ride.t:1-ride.t,dir:ride.dir,speed:ride.lift.speed}:null;}
  };
}
