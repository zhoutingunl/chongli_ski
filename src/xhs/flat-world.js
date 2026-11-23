import {keepInWindow,turnCameraAtBend,usesCameraWindow} from '../camera-window.js';
import {nearbyLiftStation} from '../lift-access.js';
import {Descent} from '../simulation.js';
import {createSkiNavigation} from '../navigation.js';
import {createMountainClimate} from '../environment.js';
import {clamp,difficultyColor} from '../mountain.js';
import {label,t} from '../language.js';

// A top-down marker preserves direction on the trail map while showing the
// same equipment, leading foot and helmet identity as the mountain view.
function drawRiderMarker(ctx,opts,sim,x,y,heading) {
  const gear=opts.gear, child=opts.gender==='boy'||opts.gender==='girl', female=opts.gender==='female'||opts.gender==='girl';
  const pace=Math.min(1,Math.max(0,sim.speed/22)), edge=sim.edge||0, brake=sim.brake||0;
  const outline='#344850', deck=child?'#b5d4cb':'#dfc69b';
  const helmet=opts.gender==='boy'?'#5492a4':opts.gender==='girl'?'#f2d5b2':female?'#bbc7bf':'#3d4648';
  function line(x1,y1,x2,y2,ink,width) {
    ctx.strokeStyle=ink;ctx.lineWidth=width;ctx.beginPath();ctx.moveTo(x1,y1);ctx.lineTo(x2,y2);ctx.stroke();
  }
  function oval(cx,cy,rx,ry,angle,ink){
    ctx.save();ctx.translate(cx,cy);ctx.rotate(angle);ctx.scale(rx,ry);
    ctx.beginPath();ctx.arc(0,0,1,0,Math.PI*2);ctx.fillStyle=ink;ctx.fill();ctx.restore();
  }
  ctx.save();ctx.translate(x,y-Math.min(12,(sim.airHeight||0)*12));ctx.rotate(heading);
  if(child)ctx.scale(.83,.83);
  if(gear==='board'){
    oval(0,0,4.7,15,-edge*.065,outline);oval(0,0,3.5,13.8,-edge*.065,deck);
    line(-2.5,-3,2,-5,outline,2.4);line(-2,4,2.7,5,outline,2.4);
  }else for(const s of [-1,1]){
    const toe=s*(3.4-(child?1.6:.7)*brake);
    line(s*(3.4+brake),10,toe,-15,outline,3.3);line(s*(3.4+brake),10,toe,-15,deck,1.7);
  }
  const tilt=gear==='board'?.80-edge*.22:edge*.18;
  ctx.save();ctx.translate(edge*1.35,0);ctx.rotate(tilt);
  const width=child?5.2:5.6,arm=width+2+Math.abs(edge)*(child?3:1.8);
  for(const s of [-1,1]){
    const tip=s*arm,front=-2.8-2.8*pace+s*edge*2.5;
    line(s*width,-1,tip,front,outline,2.8);
    if(gear!=='board')line(tip,front,tip+s*(2-.8*pace),front+8+6*pace,'#607378',.95);
  }
  oval(0,0,width+1.0,4.9,0,outline);oval(0,0,width,4.2,0,opts.color||'#b96a47');
  if(!child&&!female)oval(0,1.8,2.35,2.3,0,'#506263');
  ctx.restore();
  const headY=-3.6-2.6*pace,hr=child?4.5:4.0;
  oval(edge*.65,headY,hr+.6,hr+.8,0,outline);oval(edge*.65,headY,hr,hr+.22,0,helmet);
  line(-hr*.55+edge*.65,headY-2.1,hr*.55+edge*.65,headY-2.1,'#4e8392',1.3);
  ctx.restore();
}

export function createFlatWorld(canvas,data,opts,onEvent,climate=createMountainClimate()) {
  const ctx=canvas.getContext('2d');
  if(!ctx)throw new Error('Canvas 2D is unavailable');
  canvas.hidden=false;
  const sim=new Descent(data,opts), navigation=createSkiNavigation(data);
  const input={steer:0,trim:0,brake:false,boost:false,lookX:0,lookY:0};
  let station=null,ride=null,paused=false,active=false,videoCanvasLocked=false;
  let yaw=0,zoom=1,panX=0,panY=0,frame=0,last=0,hudAge=0,snowMarks=[];
  let autoCamera=false,cameraLane=0,routeBearing=0,orbitMovedAt=-Infinity;
  let conditions=climate.sample(opts.time,opts.weather);
  const refreshClimate=()=>{conditions=climate.sample(opts.time,opts.weather);};
  function gates(route,at,side,lift,end='top',summit=false){
    sim.start(route);Object.assign(sim,{mode:summit?'summit':'station',x:at.position[0],z:at.position[1],heading:at.heading,travelHeading:at.heading,trail:null});
    sim.y=sim.ground=sim.startY=data.height(sim.x,sim.z);
    station={side,lift,end,summit,view:'wide'};ride=null;resetView();draw();kick();
  }
  function stage(route){
    const place=data.summitPlaces[route.resort];
    const lift=data.lifts.find(l=>l.id===place.liftId);
    gates(route,place,route.resort,lift,place.stationEnd,true);
  }
  function resetView(){
    canvas.hidden=false;active=true;paused=false;last=0;yaw=0;zoom=1;panX=panY=0;snowMarks=[];autoCamera=false;orbitMovedAt=-Infinity;
  }
  function start(route,options){
    sim.start(navigation.safeRun(route),options);climate.startRun(opts.time);refreshClimate();station=ride=null;resetView();draw();kick();
  }
  function trailhead(route){
    const point=route.frame(0);
    gates(route,{position:[point.x,point.z],heading:point.angle},route.resort);
    station.trailhead=true;sim.mode='trailhead';
  }
  function pushOff(turn=0,preferred,heading){
    if(!station)return null;
    const angle=Number.isFinite(heading)?heading:sim.heading+yaw+turn;
    const route=station.trailhead&&!turn?sim.route:navigation.departure(station.side,sim.x,sim.z,angle,preferred);
    if(!route)return null;
    start(route);if(!Number.isFinite(heading))sim.freeHeading(angle);sim.speed=2.15;
    return sim.route;
  }
  function nearestStation(){
    if(station?.lift)return {lift:station.lift,end:station.end};
    return nearbyLiftStation(data,sim);
  }
  function beginRide(){
    const here=nearestStation();
    if(!here)return false;
    const {lift,end}=here;
    const line=[];
    for(let i=1;i<lift.points.length;i++){
      const [x,z]=lift.points[i-1], [bx,bz]=lift.points[i];
      const length=Math.hypot(bx-x,bz-z);
      line.push({x,z,bx,bz,length});
    }
    const length=line.reduce((sum,part)=>sum+part.length,0);
    ride={lift,line,length,along:end==='top'?length:0,dir:end==='top'?-1:1,speed:5.8};
    station=null;sim.mode='lift';sim.speed=0;paused=false;last=0;kick();return true;
  }
  function leaveRide(){
    if(!ride)return;
    const {lift,dir}=ride,side=lift.resort,end=dir<0?'bottom':'top';
    const route=data.routes.find(r=>r.id===side+'-classic');
    if(end==='top'&&lift.id===data.summitPlaces[side].liftId)stage(route);
    else {
      const position=navigation.stationExit(lift,end);
      const point=lift.points[end==='top'?lift.points.length-1:0];
      gates(route,{position,heading:Math.atan2(point[0]-position[0],position[1]-point[1])},side,lift,end);
    }
    onEvent('disembark',{side,route,mode:sim.mode,end});
  }
  function moveLift(dt){
    ride.along=clamp(ride.along+ride.dir*dt*ride.speed,0,ride.length);
    let travelled=ride.along;
    for(const part of ride.line){
      if(travelled>part.length){travelled-=part.length;continue;}
      const fraction=travelled/Math.max(.01,part.length);
      sim.x=part.x+fraction*(part.bx-part.x);sim.z=part.z+fraction*(part.bz-part.z);
      sim.y=data.height(sim.x,sim.z)+10;break;
    }
    if(ride.dir>0?ride.along>=ride.length:ride.along<=0)leaveRide();
  }
  function site(kind){
    const side=station?.side||ride?.lift.resort||(sim.mode==='finished'?sim.route.destination:sim.route.resort);
    return data.landmarks.find(p=>p.id===side+'-'+kind);
  }
  function draw(){
    if(!active||!sim.route)return;
    const w=videoCanvasLocked?canvas.width:canvas.clientWidth,h=videoCanvasLocked?canvas.height:canvas.clientHeight;
    if(!w||!h)return;
    if(canvas.width!==w||canvas.height!==h){canvas.width=w;canvas.height=h;}
    const subject=station?.view==='lodge'?site('lodge'):null;
    const scale=Math.min(w,h)/((station?.view==='valley'?780:320)/zoom);
    const framed=performance.now()-orbitMovedAt>480&&usesCameraWindow(sim,input);
    if(framed){
      if(!autoCamera){cameraLane=sim.offset;routeBearing=sim.guideHeading;}
      cameraLane=keepInWindow(cameraLane,sim.offset,w*.24/scale);
      routeBearing=turnCameraAtBend(routeBearing,sim.guideHeading,.135);
    }
    autoCamera=framed;
    const lateral=framed?cameraLane-sim.offset:0;
    const x=subject?.x??sim.x+Math.cos(sim.guideHeading)*lateral;
    const z=subject?.z??sim.z+Math.sin(sim.guideHeading)*lateral;
    const headingUp=(sim.mode==='summit'||sim.mode==='run');
    const forward=(framed?routeBearing:sim.heading)+yaw;
    const bearing=headingUp?-forward:yaw;
    const co=Math.cos(bearing),si=Math.sin(bearing);
    const centerX=w*.5+panX,centerY=h*.49+panY;
    function position(px,pz){
      const dx=px-x,dz=pz-z;
      return [centerX+(dx*co-dz*si)*scale,centerY+(dx*si+dz*co)*scale];
    }
    const night=conditions.nightAmount>.50;
    ctx.fillStyle=night?'#1f3047':'#edf3f5';ctx.fillRect(0,0,w,h);
    ctx.lineCap='round';ctx.lineJoin='round';
    function trace(points,color,width){
      ctx.beginPath();
      for(let i=0;i<points.length;i++){
        const point=position(...points[i]);
        if(i)ctx.lineTo(...point);else ctx.moveTo(...point);
      }
      ctx.lineWidth=width;ctx.strokeStyle=color;ctx.stroke();
    }
    for(const trail of data.trails){
      trace(trail.points,night?'#435873':'#c3d6dd',Math.max(2,trail.width*scale*.72));
      trace(trail.points,difficultyColor[trail.difficulty]||'#627f91',1.6);
    }
    if(sim.mode!=='summit')trace(sim.route.points,night?'#ffc77f':'#a45e23',2.7);
    ctx.setLineDash([4,6]);
    for(const lift of data.lifts)trace(lift.points,night?'#adb8c8':'#678490',1);
    ctx.setLineDash([]);
    ctx.fillStyle=night?'#c8d5dc':'#506a79';ctx.font='12px sans-serif';
    for(const place of data.landmarks){
      const [px,py]=position(place.x,place.z);
      if(px<4||px>w-4||py<0||py>h)continue;
      ctx.fillRect(px-3,py-3,6,6);
      if(place.kind==='hall'||place.kind==='lodge')ctx.fillText(label(place.name),px+8,py+4);
    }
    if(snowMarks.length>1)trace(snowMarks,night?'#7b9cb4':'#7d9cae',1.4);
    const [px,py]=position(sim.x,sim.z), heading=sim.heading+bearing;
    drawRiderMarker(ctx,opts,sim,px,py,heading);
    const marker=navigation.nearbyChoices(sim);
    if(marker){
      ctx.save();ctx.font='bold 13px sans-serif';ctx.textAlign='center';ctx.lineWidth=3;
      ctx.fillStyle=night?'#f9e5be':'#204857';ctx.strokeStyle=night?'#253044':'#f3f4e8';
      const placed=[];
      for(const opt of marker.options){
        const anchor=opt.paintPosition||opt.position;
        if(!anchor)continue;
        const [ax,ay]=position(...anchor);
        const view=Math.atan2(anchor[0]-sim.x,sim.z-anchor[1]);
        if(Math.cos(view-forward)<.28||ax<8||ax>w-8||ay<10||ay>h-16)continue;
        const text=label(opt.name),width=ctx.measureText(text).width;
        const tx=clamp(ax,width*.55+5,w-width*.55-5);
        let ty=ay-4;
        for(const old of placed)if(Math.abs(tx-old.x)<(width+old.width)*.5+5&&Math.abs(ty-old.y)<19)ty=old.y+18;
        placed.push({x:tx,y:ty,width});
        ctx.strokeText(text,tx,ty);ctx.fillText(text,tx,ty);
        ctx.save();ctx.translate(ax,ay+6);ctx.rotate(opt.heading+bearing);
        ctx.beginPath();ctx.moveTo(0,-4);ctx.lineTo(3.6,3);ctx.lineTo(-3.6,3);ctx.closePath();ctx.fill();ctx.restore();
      }
      ctx.restore();
    }
    ctx.fillStyle=night?'#cbdce5':'#4e6572';ctx.font='13px sans-serif';
    ctx.fillText(t('轻量雪道视图','Lightweight trail view'),12,h*.34);
  }
  function loop(now){
    frame=0;if(!active||document.hidden)return;
    const dt=last?Math.min(.085,(now-last)/1000):1/30;
    if(last&&!paused&&now-last<31){kick();return;}
    last=now;
    if(!paused){
      climate.advance(dt,opts.time,opts.weather,sim.mode==='run');
      if(input.lookX){orbitMovedAt=performance.now();yaw+=input.lookX*dt*1.75;}
      if(ride)moveLift(dt);
      else if(sim.mode==='run'){
        sim.tick(dt,input);
        if(!sim.airborne&&sim.speed>.65){
          snowMarks.push([sim.x,sim.z]);
          if(snowMarks.length>110)snowMarks.shift();
        }
        if(sim.mode==='finished')onEvent('finish',sim);
      }
    }
    hudAge+=dt;
    if(hudAge>.12){refreshClimate();hudAge=0;onEvent('hud',sim);}
    draw();if(!paused)kick();
  }
  function kick(){if(active&&!frame&&!document.hidden)frame=requestAnimationFrame(loop);}
  function redraw(){draw();kick();}
  window.addEventListener('resize',redraw);
  return {
    flat:true,sim,input,start,stage,trailhead,pushOff,beginRide,leaveRide,
    lockVideoCanvas(){
      videoCanvasLocked=true;canvas.classList.add('video-frame-locked');
      return ()=>{videoCanvasLocked=false;canvas.classList.remove('video-frame-locked');redraw();};
    },
    get conditions(){return conditions;},
    get station(){return station;},
    recoverToPiste(){
      if(!sim.recoverToPiste())return false;
      yaw=0;snowMarks=[];redraw();return true;
    },
    get nearbyStation(){const near=nearestStation();return near?{name:near.lift.name,end:near.end}:null;},
    get liftInfo(){return ride?{name:ride.lift.name,resort:ride.lift.resort,dir:ride.dir,speed:ride.speed,
      progress:ride.dir>0?ride.along/ride.length:1-ride.along/ride.length}:null;},
    get nextFlag(){return null;},
    get looking(){return Math.abs(yaw)>.03||Math.abs(zoom-1)>.03||station?.view!=='wide'&&!!station;},
    get facing(){return (autoCamera?routeBearing:sim.heading)+yaw;},
    pushTowardsView(){sim.freeHeading(this.facing);yaw=0;redraw();},
    summitHeading(route){return station?.summit?navigation.summitHeading(station.side,route):undefined;},
    pause(value){paused=value;last=0;redraw();},
    stop(){active=false;if(frame)cancelAnimationFrame(frame);frame=0;sim.mode='idle';canvas.hidden=true;},
    environment(){refreshClimate();redraw();},
    graphics:redraw,
    changeRider(){sim.gear=opts.gear;redraw();},
    cameraChanged:redraw,
    lookAroundStation(name){if(station)station.view=name;redraw();},
    lookAtBaseHall(){const hall=site('hall');if(hall){yaw=-Math.atan2(hall.x-sim.x,sim.z-hall.z);redraw();}},
    centerLook(){orbitMovedAt=-Infinity;yaw=0;zoom=1;panX=panY=0;if(station)station.view='wide';redraw();},
    orbit(dx,dy){if(dx||dy)orbitMovedAt=performance.now();yaw+=dx*.008;zoom=clamp(zoom*Math.exp(-dy*.003),.55,2.6);redraw();}
  };
}

