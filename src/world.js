import {LiftHelmet} from './lift-helmet.js';
import {trialClimate,blendScenery,sceneById,cloudFloor,cloudRoof} from './scenery.js';
import {sceneryUniforms,applySceneryUniforms} from './scenic-materials.js';
import {createIceDust} from './ice-dust.js';
import {GlideCamera,cameraWindowMetres,frontCameraTarget,previewGlide,usesCameraWindow} from './camera-window.js';
import {DescentFrames} from './descent-frames.js';
import {nearbyLiftStation} from './lift-access.js';
import {placeLiftSupports} from './lift-supports.js';
import * as THREE from 'three';
import {createRider} from './rider.js';
import {createLandmark,createLift,createResortDistricts,setResortNight} from './resort.js';
import {Descent} from './simulation.js';
import {createSkiNavigation} from './navigation.js';
import {createSky,buildSurface,plantForest,bindScenicBuildings} from './landscape.js';
import {createMountainClimate} from './environment.js';
import {courseDetails,makeSnowFX} from './details.js';
import {createTrailGuide} from './trail-guide.js';
import {clamp,mixAngle} from './mountain.js';
import {isMiniTool} from './platform.js';
import {createSnowAir} from './snow-air.js';
import {createSnowLighting} from './snow-light-shafts.js';

const up=new THREE.Vector3(0,1,0);
export async function createWorld(el,data,opts,onEvent,onProgress=()=>{},climate=createMountainClimate(),pisteProgress) {
  const renderer=new THREE.WebGLRenderer({canvas:el,antialias:!isMiniTool,alpha:false,powerPreference:isMiniTool?'default':'high-performance',stencil:false});
  renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.02;
  renderer.shadowMap.enabled=!isMiniTool;renderer.shadowMap.type=THREE.PCFShadowMap;
  let shaderFailure=false;
  if(isMiniTool)renderer.debug.onShaderError=()=>{shaderFailure=true;};
  const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(64,1,.09,55000);
  scene.fog=new THREE.FogExp2(0xc9d5db,.00011);
  const sun=new THREE.DirectionalLight(0xffe7cc,1.55),hemi=new THREE.HemisphereLight(0xe9f3ff,0x8d9aab,1.6);
  sun.shadow.camera.left=sun.shadow.camera.bottom=-67;sun.shadow.camera.right=sun.shadow.camera.top=67;
  sun.shadow.camera.near=4;sun.shadow.camera.far=292;
  sun.shadow.mapSize.set(1024,1024);sun.shadow.bias=-.00012;sun.shadow.normalBias=.087;
  sun.shadow.intensity=.84;sun.shadow.radius=2.2;
  // Near sunset a ray nearly parallel to a piste can carry a billboard trunk
  // across the whole valley. Bound the shadow projection in elevation while
  // the sky, snow highlights and direct light keep the astronomical direction.
  const shadowOrigin=new THREE.Vector3(),shadowTarget=new THREE.Vector3();
  const shadowProjector={matrixWorld:new THREE.Matrix4(),target:sun.target};
  const updateShadow=sun.shadow.updateMatrices.bind(sun.shadow);
  sun.shadow.updateMatrices=light=>{
    shadowTarget.setFromMatrixPosition(light.target.matrixWorld);
    shadowOrigin.setFromMatrixPosition(light.matrixWorld).sub(shadowTarget);
    const flat=Math.hypot(shadowOrigin.x,shadowOrigin.z);
    const minimum=conditions?.sceneId==='moon'?.34:.55;
    shadowOrigin.y=Math.max(shadowOrigin.y,minimum*flat);
    shadowOrigin.setLength(143).add(shadowTarget);
    shadowProjector.matrixWorld.makeTranslation(shadowOrigin);
    updateShadow(shadowProjector);
  };
  sun.castShadow=true;scene.add(sun,sun.target,hemi);
  const scenic=sceneryUniforms(),iceDust=createIceDust(scene);
  let trial=null,transition=null;
  const sky=createSky(scene,scenic),source=new THREE.Vector3();
  let forest,surface;
  onProgress('铺展雪道与远山');
  await Promise.all([buildSurface(scene,data,scenic).then(s=>{surface=s;}),plantForest(scene,data,scenic,(id,state)=>{onEvent('grove',{id,state});kick();}).then(f=>{forest=f;})]);
  onProgress('装配雪具与索道');await new Promise(r=>setTimeout(r,0));
  const rotations={wanlong:{lodge:-2.92,hall:.17},genting:{lodge:1.72,hall:-1.86}};
  const landmarks=[],landmarkViews=new Map();
  for(const k of data.landmarks.filter(l=>l.kind==='lodge'||l.kind==='hall')){
    const group=createLandmark(k.kind==='lodge'?'summit':'base',k.resort);group.position.set(k.x,data.height(k.x,k.z)-.04,k.z);group.rotation.y=rotations[k.resort][k.kind];scene.add(group);landmarks.push(group);
    const box=new THREE.Box3().setFromObject(group),size=new THREE.Vector3();box.getSize(size);
    const focus=box.getCenter(new THREE.Vector3());focus.y=group.position.y+size.y*.46;
    landmarkViews.set(k.id,{focus,yaw:group.rotation.y,distance:Math.max(22,Math.hypot(size.x,size.z)*.70),kind:k.kind});
  }
  const districts=createResortDistricts(data);
  for(const group of districts.groups){scene.add(group);landmarks.push(group);}
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
  bindScenicBuildings([...landmarks,...lifts.map(l=>l.group)],scenic);
  const helmet=new LiftHelmet();
  const navigation=createSkiNavigation(data);
  const details=courseDetails(scene,data,navigation,districts.modeled);
  const trailGuide=createTrailGuide(scene,data,renderer,pisteProgress,surface.detail);
  const snowAir=createSnowAir(scene,data),fx=makeSnowFX(scene,data,snowAir);
  let renderLighting,lightingLimited=false;
  let rider=createRider(opts);scene.add(rider.group);bindScenicBuildings([rider.group],scenic,true);
  const sim=new Descent(data,opts,rider.dimensions);
  const descentFrames=new DescentFrames(sim);
  const yawQ=new THREE.Quaternion(),tiltQ=new THREE.Quaternion(),surfNorm=new THREE.Vector3(),want=new THREE.Vector3(),look=new THREE.Vector3(),target=new THREE.Vector3();
  let active=false,paused=false,ride=null,clock=0,prev=0,lastUI=0,treesLag=1,camHeading=0,snap=true,frame=0,graphicsScale=1;
  let station=null,baseTurn=null,videoCanvasLocked=false;
  let conditions,climateAge=1;
  const bodyOrigin=new THREE.Vector3(),lastRiderOrigin=new THREE.Vector3(),lastOrigin=new THREE.Vector3(),bodyStep=new THREE.Vector3();
  const trackingOrigin=new THREE.Vector3();
  const glideCamera=new GlideCamera();
  let autoCamera=false,previewRoute=null,glideGrade=0,horizonPitch=0;
  const eyeOffset=new THREE.Vector3(),tipWorld=new THREE.Vector3(),sight=new THREE.Vector3(),orbitPivot=new THREE.Vector3(),frontEyes=new THREE.Vector3();
  const reducedMotion=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const pitchLimit=THREE.MathUtils.degToRad(85);
  let lookYaw=0,lookPitch=0,headPitch=0,roll=0,baseBearing=0,lookMovedAt=-Infinity;
  const input={steer:0,trim:0,brake:false,boost:false,lookX:0,lookY:0};
  const wrap=angle=>Math.atan2(Math.sin(angle),Math.cos(angle));
  function resetLook(){lookYaw=lookPitch=0;lookMovedAt=-Infinity;input.lookX=input.lookY=0;}
  function panLook(yaw,pitch){
    if(yaw||pitch)lookMovedAt=clock;
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
    if(videoCanvasLocked)return;
    const width=host.clientWidth||innerWidth,height=host.clientHeight||innerHeight;
    const maxDpr=opts.quality==='lite'?1:opts.quality==='high'?1.8:1.4;
    const pixelLimit=isMiniTool?Math.sqrt(2000000/(width*height)):Infinity;
    renderer.setPixelRatio(Math.min(devicePixelRatio||1,maxDpr,isMiniTool?1.35:Infinity,pixelLimit)*graphicsScale);
    renderer.setSize(width,height,false);
    camera.aspect=width/height;camera.updateProjectionMatrix();kick();
  }
  const observer=new ResizeObserver(resize);observer.observe(host);resize();
  function environment(){
    conditions=trialClimate(trial,opts,climate);
    if(transition){
      const fraction=(clock-transition.start)/2.4;
      if(fraction>=1)transition=null;
      else conditions=blendScenery(transition.from,conditions,fraction);
    }
    const e=conditions;
    applySceneryUniforms(scenic,e);iceDust(e,isMiniTool||opts.quality==='lite');
    sky.apply(e);forest.setLight(e);surface.setLight(e);setResortNight(e.lampAmount);
    scene.fog.color.set(e.fog);scene.fog.density=e.density*(.69+.31*e.snowAmount);sun.color.set(e.sun);sun.intensity=e.light;
    sun.shadow.intensity=(e.sceneId==='moon'?.56:.42)+.42*THREE.MathUtils.smoothstep(e.dir[1],.08,.55);
    if(e.sceneId==='cloudsea'){
      const depth=Math.min(camera.position.y-cloudFloor,cloudRoof-camera.position.y);
      scene.fog.density+=.0016*THREE.MathUtils.smoothstep(depth,0,12)*(e.sceneStrength??1);
    }
    hemi.intensity=e.ambient;hemi.color.set(e.hemi);hemi.groundColor.set(e.ground);source.fromArray(e.dir).normalize();
    renderer.toneMappingExposure=e.exposure;
  }
  environment();
  function updateAvatar(dt,p=sim){
    rider.group.visible=!ride;
    const embodied= (!station || station.view==='wide' || opts.view==='first');
    rider.setVisibility(embodied&&opts.view==='first'?'first':embodied&&opts.view==='tips'?'tips':'body');
    rider.group.position.set(p.x,p.y+.004-p.snowSink,p.z);
    const span=p.snowTerrain?.relief ? .67 : 2;
    surfNorm.set((data.height(p.x-span,p.z)-data.height(p.x+span,p.z))/(2*span),
      1,(data.height(p.x,p.z-span)-data.height(p.x,p.z+span))/(2*span)).normalize();
    if(p.airHeight>.1)surfNorm.lerp(up,clamp(p.airHeight*.8,0,1)).normalize();
    tiltQ.setFromUnitVectors(up,surfNorm);yawQ.setFromAxisAngle(up,-p.heading);tiltQ.multiply(yawQ);
    if(snap||baseTurn)rider.group.quaternion.copy(tiltQ);else rider.group.quaternion.slerp(tiltQ,1-Math.exp(-dt*32));
    rider.update(p,dt,clock,helmet.progress);
    surface.setRiderShadow(!ride&&(!renderer.shadowMap.enabled||!sun.castShadow||opts.view==='first'||opts.view==='tips')?rider:null);
  }
  function moveCamera(dt,p=sim){
    const mode=opts.view,run=p.mode==='run';
    const bodyScale=rider.dimensions.scale;
    const travel=p.travelHeading??p.heading,fast=clamp(p.speed/22,0,1);
    const first=mode==='first'&&!ride;
    const frontRun=mode==='front'&&run&&!ride;
    const laneShare=frontRun ? .32 : 1;
    const tips=mode==='tips'&&!ride&&(!station||station.view==='wide');
    const cameraEase=snap?1:1-Math.exp(-dt*8);
    const pitchEase=snap?1:1-Math.exp(-dt*7.5);
    if(!baseTurn&&!paused&&(input.lookX||input.lookY))panLook(input.lookX*dt*1.95,input.lookY*dt*1.38);
    const plan=clock-lookMovedAt>.48&&usesCameraWindow(p,input,frontRun&&autoCamera)?previewGlide(p):null;
    const framed=!!plan&&!first&&!tips;
    if(plan){
      const bearing=framed?plan.course:plan.rideBearing;
      if(!previewRoute||snap)glideCamera.reset(snap?bearing:camHeading,p.offset);
      else if(previewRoute!==p.route){
        // Keep the framing in world space when a branch changes its local centre line.
        const lateral=(lastOrigin.x-lastRiderOrigin.x)*Math.cos(p.guideHeading)+
          (lastOrigin.z-lastRiderOrigin.z)*Math.sin(p.guideHeading);
        glideCamera.resetLane(p.offset+lateral/laneShare);
      }
      camHeading=glideCamera.aim(bearing,dt);
    }else{
      camHeading=snap?travel:mixAngle(camHeading,travel,1-Math.exp(-dt*(first?6:4.8)));
    }
    previewRoute=plan?p.route:null;
    bodyOrigin.set(p.x,p.y,p.z);trackingOrigin.copy(bodyOrigin);
    let fov=61,bank=0,addPitch=0,heading=camHeading,lockEye=false;
    if(ride){
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
      baseBearing=camHeading+(run && !plan ? .11*(p.slipAngle||0) : 0);
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
      let back=4.6+fast*1.25,side=0,lift=1.82+fast*.22,lead=4.8+fast*.7,eye=1.35;
      if(mode==='low'){back=3.25;lift=.38;lead=3;eye=1.02;fov=70;}
      if(mode==='top'){back=1.65;lift=26;lead=.45;eye=0;fov=54;}
      if(mode==='left'||mode==='right'){back=1.8;side=mode==='right'?4.8:-4.8;lift=1.44;lead=.59;eye=.95;}
      if(mode==='front'){back=-4.3;side=.32;lift=1.48;lead=0;eye=1.01;}
      if(mode==='far'){back=15;side=4.4;lift=4.8;lead=3.4;eye=1.2;}
      if(mode==='follow'){
        back=2.92+fast*.48;lift=1.40+fast*.15;lead=2.85;eye=.91;
        fov=57+(reducedMotion?1:4)*fast;
        if(run&&!framed&&!reducedMotion)bank=clamp((p.curve||0)*fast*.062+(p.edge||0)*fast*.016,-.048,.048);
      }
      if(mode!=='top'&&mode!=='far'){
        const framing=.40+.60*bodyScale;
        back*=framing;side*=framing;lead*=framing;lift*=framing;eye*=bodyScale;
      }
      const terrainBoom=framed||frontRun;
      const depth=terrainBoom ? Math.hypot(back,side,lift) : 0;
      let gradeX=0,gradeZ=0;
      if(framed){
        const margin=cameraWindowMetres(fov,camera.aspect,depth);
        const lateral=(glideCamera.followLane(plan.lane,margin,dt)-p.offset)*laneShare;
        trackingOrigin.x+=Math.cos(p.guideHeading)*lateral;
        trackingOrigin.z+=Math.sin(p.guideHeading)*lateral;
      }
      if(terrainBoom){
        // A short length of snow supports the camera boom. Individual bumps
        // still move the skier, while the view follows the surrounding slope.
        const span=3+4*fast+Math.min(9,depth*.40);
        const course=framed?plan.course:camHeading,tx=Math.sin(course),tz=-Math.cos(course);
        const ax=trackingOrigin.x,az=trackingOrigin.z;
        const behind=data.height(ax-span*tx,az-span*tz),ahead=data.height(ax+span*tx,az+span*tz);
        trackingOrigin.y=(behind+2*data.height(ax,az)+ahead)*.25;
        const grade=(ahead-behind)/(2*span);
        glideGrade=(autoCamera||frontRun)&&!snap?glideGrade+(grade-glideGrade)*-Math.expm1(-4.5*dt):grade;
        gradeX=glideGrade*tx;gradeZ=glideGrade*tz;
      }
      const dx=(back,side)=>trackingOrigin.x-fx*back+rx*side,dz=(back,side)=>trackingOrigin.z-fz*back+rz*side;
      const x=dx(back,side),z=dz(back,side),aheadX=dx(-lead,0),aheadZ=dz(-lead,0);
      if(terrainBoom){
        const boomRise=(x-trackingOrigin.x)*gradeX+(z-trackingOrigin.z)*gradeZ;
        want.set(x,Math.max(trackingOrigin.y+lift+Math.max(0,boomRise),data.height(x,z)+Math.min(.48,lift)),z);
        if(frontRun){
          rider.group.localToWorld(rider.eyePosition(frontEyes));
          frontCameraTarget(look,trackingOrigin,p,frontEyes,bodyScale);
        }else{
          const aimRise=(aheadX-trackingOrigin.x)*gradeX+(aheadZ-trackingOrigin.z)*gradeZ;
          look.set(aheadX,trackingOrigin.y+eye+aimRise*.75,aheadZ);
        }
      }else{
        want.set(x,Math.max(p.y+lift,data.height(x,z)+lift),z);
        look.set(aheadX,p.y+eye+(data.height(aheadX,aheadZ)-p.ground)*.75,aheadZ);
      }
      baseBearing=wrap(Math.atan2(look.x-want.x,want.z-look.z)-lookYaw);
      addPitch=lookPitch;
      if(!snap){
        if(framed===autoCamera)bodyStep.copy(trackingOrigin).sub(lastOrigin);
        else bodyStep.copy(bodyOrigin).sub(lastRiderOrigin);
        camera.position.add(bodyStep);target.add(bodyStep);
      }
    }
    autoCamera=framed;lastOrigin.copy(trackingOrigin);lastRiderOrigin.copy(bodyOrigin);
    if(snap||lockEye||baseTurn){camera.position.copy(want);target.copy(look);}
    else{camera.position.lerp(want,cameraEase);target.lerp(look,cameraEase);}
    if(!ride)camera.position.y=Math.max(camera.position.y,data.height(camera.position.x,camera.position.z)+.15);
    camera.up.copy(up);
    {
      sight.copy(target).sub(camera.position);
      const horizontal=Math.max(.001,Math.hypot(sight.x,sight.z));
      const rawPitch=Math.atan2(sight.y,horizontal);
      horizonPitch=plan&&!snap?horizonPitch+(rawPitch-horizonPitch)*-Math.expm1(-(framed?6:9)*dt):rawPitch;
      const basePitch=horizonPitch;
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
    if((first||mode==='follow'&&!ride)&&Math.abs(roll)>.0001)camera.rotateZ(roll);
    fov=snap?fov:camera.fov+(fov-camera.fov)*(1-Math.exp(-dt*7));
    if(Math.abs(camera.fov-fov)>.008){camera.fov=fov;camera.updateProjectionMatrix();}
    sky.mesh.position.copy(camera.position);
    sun.target.position.set(p.x,p.y,p.z).lerp(camera.position,.27);
    sun.position.copy(sun.target.position).addScaledVector(source,143);
    snap=false;
  }
  function refreshLOD(){
    surface.locate?.(sim.x,sim.z,opts.quality);
    details.locate(camera.position.x,camera.position.z);
    forest.locate(camera.position.x,camera.position.z,opts.quality,sim.x,sim.z,sun.castShadow?160:0);
    const max=opts.quality==='lite'?1400:2400;
    for(const l of lifts){
      l.group.visible=l===ride?.lift||Math.hypot(l.center.x-camera.position.x,l.center.z-camera.position.z)<max+l.radius;
      const shadow=l.group.visible && opts.quality==='high' && l.meta.points.some(([x,z])=>Math.hypot(x-sim.x,z-sim.z)<55);
      for(const mesh of l.casters)mesh.castShadow=shadow;
    }
    for(const g of landmarks)g.visible=Math.hypot(g.position.x-camera.position.x,g.position.z-camera.position.z)<(opts.quality==='lite'?1800:3400);
  }
  function resetScene(route){
    sim.start(route);station=null;ride=null;paused=false;active=true;resetLook();
    baseTurn=null;sim.pivotRate=0;
    snap=true;treesLag=1;lastUI=prev=0;
    input.trim=input.steer=0;input.boost=input.brake=false;fx.reset();snowAir.reset();
  }
  function showScene(){descentFrames.reset();updateAvatar(0);moveCamera(0);refreshLOD();kick();}
  function start(route){helmet.reset();route=navigation.safeRun(route);resetScene(route);environment();details.setRoute(route);showScene();}
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
    sim.trail=null;sim.onTrail=false;sim.upperGuide=place.guide;
    const ahead=data.height(sim.x+12*Math.sin(place.heading),sim.z-12*Math.cos(place.heading));
    const restPitch=summit?-.08-clamp(Math.atan2(sim.ground-ahead,12),0,.4):-.055;
    station={side,lift,end,summit,guide:place.guide,eye:point(place.camera.position,place.camera.height),
      target:point(place.camera.target,place.camera.targetHeight),fov:place.camera.fov||58,restPitch};
    station.homeEye=station.eye.clone();station.homeTarget=station.target.clone();station.view='wide';
    if(lift&&end==='bottom'&&!summit)parkFacing(place.heading);
    resetLook();showScene();
  }
  function stage(route,arrivalLift){
    helmet.reset();
    const side=route.resort,place=data.summitPlaces[side];
    stopAt(route,place,side,arrivalLift||lifts.find(l=>l.meta.id===place.liftId),place.stationEnd,true);
  }
  function pushOff(turn=0,preferred,routeHeading){
    if(!station)return null;
    const poseHeading=baseTurn?sim.heading:wrap(baseBearing+lookYaw),requested=Number.isFinite(routeHeading)?routeHeading:wrap(poseHeading+turn);
    const facingFork=sim.junctions[0]?.index===0&&Math.abs(wrap(poseHeading-sim.heading))>.35;
    const guide=station.guide;
    const route=station.trailhead&&!turn&&!facingFork?sim.route:navigation.departure(station.side,sim.x,sim.z,requested,preferred,guide);
    if(!route)return null;
    const wasHead=opts.view==='first',oldPitch=headPitch,oldLookPitch=lookPitch;
    resetScene(route);sim.upperGuide=guide;environment();
    if(!Number.isFinite(routeHeading))sim.freeHeading(guide?route.frame(0).angle:requested);
    sim.speed=sim.maxSpeed=2.15;sim.push=.75;
    details.setRoute(route);camHeading=poseHeading;headPitch=oldPitch;
    if(wasHead){snap=false;lookPitch=oldLookPitch;lastOrigin.set(sim.x,sim.y,sim.z);}
    showScene();return route;
  }
  function trailhead(route){
    helmet.reset();
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
    helmet.board();sim.splits.finish();
    const {lift,end}=here,dir=end==='top'?-1:1;
    station=baseTurn=null;sim.pivotRate=0;resetLook();
    ride={lift,dir,t:dir>0?.004:.996,look:.09,pitch:0};sim.mode='lift';sim.speed=0;
    const eye=lift.seatAt(ride.t,dir);sim.x=eye.x;sim.z=eye.z;sim.y=eye.y;
    paused=false;snap=true;treesLag=1;prev=0;kick();return true;
  }
  function leaveRide(){
    if(!ride)return;
    helmet.unload();
    const {lift,dir}=ride,side=lift.meta.resort,end=dir>0?'top':'bottom';
    const route=data.routes.find(r=>r.id===side+'-classic');
    const at=end==='top'?lift.meta.points.at(-1):lift.meta.points[0];
    if(end==='top'){climate.arriveUpperStation(opts.time);environment();}
    const place=end==='top'&&navigation.upperStation(lift.meta);
    if(place){
      stopAt(place.route,place,side,lift,end,navigation.isSummitStation(lift.meta));
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
    onEvent('disembark',{side,route:sim.route,mode:sim.mode,end});
  }
  let heldCamera=null,heldEye=null,framedId=null;
  const framedCamera=new THREE.Quaternion();
  const previewTarget=new THREE.Vector3();
  // Find an open valley view from the held camera, without moving the athlete.
  function aimAtValley(){
    const eye=camera.position;
    let best=-Infinity,azimuth=0,pitch=-.08;
    for(let n=0;n<24;n++){
      const angle=n*Math.PI/12,dx=Math.sin(angle),dz=Math.cos(angle);
      let horizon=-Infinity;
      for(let step=1;step<=28;step++){
        const range=step*step*3.4+8;
        const height=data.height(eye.x+range*dx,eye.z+range*dz);
        const grade=(height-eye.y)/range;
        if(range>310){
          const deck=(Math.max(height+13,(cloudFloor+cloudRoof)/2)-eye.y)/range;
          const sightline=THREE.MathUtils.clamp((deck-horizon)*13,-1,1);
          const score=THREE.MathUtils.clamp((eye.y-height)/370,-1,1)+.50*sightline-.3*Math.abs(deck+.14);
          if(score>best){best=score;azimuth=angle;pitch=THREE.MathUtils.clamp(deck,-.24,.055);}
        }
        horizon=Math.max(horizon,grade);
      }
    }
    return previewTarget.set(Math.sin(azimuth),pitch,Math.cos(azimuth));
  }
  function stageThirdLift(){
    const lift=lifts.find(item=>item.meta.id==='w1368988312');
    const place=lift&&navigation.upperStation(lift.meta);
    if(!place)return false;
    stopAt(place.route,place,'wanlong',lift,'top',false);
    const tree=forest.vista(sim.x,sim.y,sim.z,data.height);
    const valley=tree?new THREE.Vector3(tree.x,0,tree.z):aimAtValley().clone();valley.y=0;valley.normalize();
    const right=new THREE.Vector3(-valley.z,0,valley.x);
    const eye=new THREE.Vector3(sim.x,0,sim.z).addScaledVector(valley,-8.8).addScaledVector(right,-1.65);
    eye.y=Math.max(data.height(eye.x,eye.z)+.76,sim.y+2.13);station.eye.copy(eye);
    station.target.copy(eye).addScaledVector(valley,48);station.target.y-=5.4;
    station.homeEye.copy(eye);station.homeTarget.copy(station.target);station.fov=55;
    camera.position.copy(eye);camera.lookAt(station.target);camera.fov=55;camera.updateProjectionMatrix();refreshLOD();
    onEvent('disembark',{side:'wanlong',route:place.route,mode:sim.mode,end:'top'});
    return true;
  }
  function previewScenery(next,fade=false,refreshAim=false){
    if(refreshAim)framedId=null;
    transition=fade?{from:conditions,start:clock}:null;
    trial=next?.active?next:null;
    const movedEye=!!heldEye;
    if(heldEye){camera.position.copy(heldEye);heldEye=null;}
    if(heldCamera){camera.quaternion.copy(heldCamera);heldCamera=null;}
    environment();
    if(!trial?.frozen||!trial.sky)framedId=null;
    if(trial?.frozen){
      heldCamera=camera.quaternion.clone();
      const near=trial.preset.group==='art'&&forest.portrait(camera.position.x,camera.position.z);
      trial.hasTree=!!near;
      if(trial.tree&&near){
        heldEye=camera.position.clone();
        const dx=near.x-heldEye.x,dz=near.z-heldEye.z,n=Math.hypot(dx,dz)||1,range=Math.max(8.,near.h*1.49);
        const x=near.x-dx*range/n+dz*range*.19/n,z=near.z-dz*range/n-dx*range*.19/n;
        camera.position.set(x,data.height(x,z)+2.3,z);
        camera.lookAt(near.x,near.y+near.h*.46,near.z);
      }else if(trial.sky&&framedId===trial.sky)camera.quaternion.copy(framedCamera);
      else if(trial.sky){
        const look=sceneById.get(trial.sky).look;
        if(look==='sun'||look==='crystals')previewTarget.fromArray(conditions.sunDir);
        else if(look==='moon')previewTarget.fromArray(conditions.moonDir);
        else if(look==='galaxy')previewTarget.set(-.15,.73,-.63);
        else if(look==='stars')previewTarget.set(.24,.48,-.84);
        else aimAtValley();
        if(look==='crystals'){previewTarget.applyAxisAngle(up,.71);previewTarget.y=.09;}
        else if(look!=='ridge')previewTarget.y=Math.max(.085,previewTarget.y);
        camera.lookAt(previewTarget.normalize().multiplyScalar(100).add(camera.position));
        framedId=trial.sky;framedCamera.copy(camera.quaternion);
      }
      fx.snowfall(0,conditions,camera.position);
      snowAir.update(0,conditions,camera.position,sim,opts.quality,isMiniTool);
    }
    if(movedEye||heldEye)refreshLOD();
    sun.position.copy(sun.target.position).addScaledVector(source,143);
    kick();
  }
  function renderFrame(){
    if(!isMiniTool&&opts.quality!=='lite')renderLighting??=createSnowLighting(renderer)||false;
    if(!isMiniTool&&opts.quality!=='lite'&&renderLighting)renderLighting(scene,camera,sun,conditions,opts.quality,lightingLimited);
    else renderer.render(scene,camera);
  }
  let adaptiveTime=0,adaptiveFrames=0;
  function loop(now){
    frame=0;if(!active)return;
    if(document.hidden){prev=0;return;}
    if(isMiniTool&&prev&&!paused&&now-prev<31){kick();return;}
    const raw=prev?(now-prev)/1000:1/60;const dt=Math.min(Math.max(raw,0),.085);prev=now;
    if(!paused){
      clock+=dt;climateAge+=dt;climate.advance(dt,opts.time,opts.weather,sim.mode==='run');
      if(transition||climateAge>.15){environment();climateAge=0;}
      const waiting=helmet.update(dt,sim,input,data,conditions.resolvedTime);
      if(ride){
        ride.t=clamp(ride.t+dt*ride.dir*ride.lift.speed/ride.lift.length,.003,.997);
        const eye=ride.lift.seatAt(ride.t,ride.dir);sim.x=eye.x;sim.z=eye.z;sim.y=eye.y;
        if(ride.dir>0?ride.t>=.997:ride.t<=.003)leaveRide();
      }else if(sim.mode==='run'&&!waiting){
        details.setRoute(sim.route);
        descentFrames.advance(dt,input);
        if(sim.mode==='finished'){
          parkFacing(camHeading+lookYaw,sim.travelHeading);
          details.setRoute(null);onEvent('finish',sim);
        }
      }
      if(baseTurn)turnInPlace(dt);
      for(const l of lifts)if(l.group.visible)l.update(clock,camera,ride?.lift===l ? ride.t : null,ride?.dir);
    }
    const pose=descentFrames.renderPose();
    if(!paused){
      updateAvatar(dt,pose);
      fx.update(pose,dt,conditions,camera.position,rider.dimensions);
    }
    if(!trial?.frozen)moveCamera(dt,pose);
    treesLag+=dt;if(treesLag>.40){refreshLOD();treesLag=0;}
    if(trial?.frozen&&trial.fromThirdLift)trailGuide.hide();
    else trailGuide.update(sim,navigation,opts.language,camera);
    if(!paused) snowAir.update(dt,conditions,camera.position,sim,opts.quality,isMiniTool);
    renderFrame();
    if(shaderFailure){active=false;onEvent('lost');return;}
    if(now-lastUI>95){onEvent('hud',sim);lastUI=now;}
    if(!videoCanvasLocked&&!paused&&raw>0&&opts.quality==='auto'){
      adaptiveTime+=raw;adaptiveFrames++;
      if(adaptiveFrames>=55){
        const slow=adaptiveTime/adaptiveFrames>.045;
        if(slow&&!isMiniTool&&renderLighting&&!lightingLimited)lightingLimited=true;
        else if(slow&&graphicsScale>.68){graphicsScale=Math.max(.67,graphicsScale-.12);resize();}
        else if(slow&&isMiniTool){active=false;onEvent('lost');}
        adaptiveTime=adaptiveFrames=0;
      }
    }
    if(!paused||(videoCanvasLocked&&trial?.frozen))kick();
  }
  function kick(){if(!frame&&active)frame=requestAnimationFrame(loop);}
  el.addEventListener('webglcontextlost',e=>{e.preventDefault();if(active){active=false;onEvent('lost');}});
  return {
    sim,input,start,stage,trailhead,pushOff,beginRide,leaveRide,
    beforeDeparture:ready=>helmet.beforeDeparture(ready),
    previewScenery,stageThirdLift,retryArt:forest.retryArt,
    photoFrame(){renderFrame();return el;},
    lockVideoCanvas(){
      videoCanvasLocked=true;adaptiveTime=adaptiveFrames=0;kick();
      el.classList.add('video-frame-locked');
      return ()=>{videoCanvasLocked=false;el.classList.remove('video-frame-locked');resize();};
    },
    lookAroundStation(view){
      if(!station)return;
      station.view=view;const side=station.side;
      if(view==='wide'){station.eye.copy(station.homeEye);station.target.copy(station.homeTarget);}
      else if(view==='valley'){
        const top=data.summitPlaces[side],hall=data.landmarks.find(l=>l.id===side+'-hall');
        const eye=point(top.position,14),dx=hall.x-eye.x,dz=hall.z-eye.z,d=Math.hypot(dx,dz);
        station.eye.copy(eye);station.target.set(eye.x+dx/d*310,eye.y-45,eye.z+dz/d*310);
      }else if(view==='lodge'){
        const shot=landmarkViews.get(side+'-lodge');
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
    continueAtBase(){
      if(!sim.continueAtBase())return false;
      baseTurn=null;sim.pivotRate=0;camHeading=sim.travelHeading;resetLook();
      fx.reset();snap=true;treesLag=1;details.setRoute(sim.route);showScene();return true;
    },
    recoverToPiste(){
      if(!sim.recoverToPiste())return false;
      resetLook();fx.reset();snowAir.reset();details.setRoute(sim.route);snap=true;treesLag=1;
      showScene();return true;
    },
    get nearbyStation(){const n=nearestStation();return n?{name:n.lift.meta.name,end:n.end}:null;},
    pause(b){paused=b;input.lookX=input.lookY=input.trim=input.steer=0;input.brake=input.boost=false;prev=0;kick();},
    stop(){helmet.reset();active=false;paused=false;ride=station=baseTurn=null;sim.pivotRate=0;if(frame)cancelAnimationFrame(frame);frame=0;sim.mode='idle';},
    environment(){environment();kick();},graphics(){graphicsScale=1;lightingLimited=false;sun.castShadow=!isMiniTool&&opts.quality!=='lite';resize();treesLag=1;kick();},
    changeRider(){
      const previousScale=rider.dimensions.scale;
      scene.remove(rider.group);rider.dispose();rider=createRider(opts);scene.add(rider.group);bindScenicBuildings([rider.group],scenic,true);
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
      const hall=landmarkViews.get(sim.route.destination+'-hall');
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
    summitHeading(routeId){if(station?.guide)return station.guide.options.find(o=>o.routeId===routeId)?.selectionHeading;return station?.summit?navigation.summitHeading(station.side,routeId):undefined;},
    orbit(dx,dy){
      const yawPerPixel=Math.PI/Math.max(170,Math.min(host.clientWidth*.46,390));
      panLook(-dx*yawPerPixel,dy*yawPerPixel*.87);
      kick();
    },
    get liftInfo(){return ride?{name:ride.lift.meta.name,resort:ride.lift.meta.resort,progress:ride.dir>0?ride.t:1-ride.t,dir:ride.dir,speed:ride.lift.speed}:null;}
  };
}
