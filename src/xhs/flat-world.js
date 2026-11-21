import {Descent} from '../simulation.js';
import {createSkiNavigation} from '../navigation.js';
import {createMountainClimate} from '../environment.js';
import {clamp,difficultyColor} from '../mountain.js';
import {label,t} from '../language.js';

export function createFlatWorld(canvas,data,opts,onEvent) {
  const ctx=canvas.getContext('2d');
  if(!ctx)throw new Error('Canvas 2D is unavailable');
  canvas.hidden=false;
  const sim=new Descent(data,opts), navigation=createSkiNavigation(data), climate=createMountainClimate();
  const input={steer:0,trim:0,brake:false,boost:false,lookX:0,lookY:0};
  let station=null,ride=null,paused=false,active=false,photo=false,photoKind='rider';
  let yaw=0,zoom=1,panX=0,panY=0,frame=0,last=0,clock=0,hudAge=0,snowMarks=[];
  let conditions=climate.sample(opts.time,opts.weather,0);
  const refreshClimate=()=>{conditions=climate.sample(opts.time,opts.weather,clock);};
  function gates(route,at,side,lift,end='top'){
    sim.start(route);Object.assign(sim,{mode:'station',x:at.position[0],z:at.position[1],heading:at.heading,travelHeading:at.heading,trail:null});
    sim.y=sim.ground=sim.startY=data.height(sim.x,sim.z);
    station={side,lift,end,view:'wide'};ride=null;resetView();draw();kick();
  }
  function stage(route){
    const place=data.summitPlaces[route.resort];
    const lift=data.lifts.find(l=>l.id===place.liftId);
    gates(route,place,route.resort,lift,place.stationEnd);
    station.summit=true;sim.mode='summit';
  }
  function resetView(){
    canvas.hidden=false;active=true;paused=photo=false;last=0;yaw=0;zoom=1;panX=panY=0;snowMarks=[];
  }
  function start(route){
    sim.start(navigation.safeRun(route));station=ride=null;resetView();draw();kick();
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
    start(route);sim.speed=2.15;
    return sim.route;
  }
  function nearestStation(){
    if(station?.lift)return {lift:station.lift,end:station.end};
    if(ride||!sim.route)return null;
    const finished=sim.mode==='finished';
    let best=null,min=finished?Infinity:48;
    for(const lift of data.lifts){
      if(finished&&lift.resort!==sim.route.destination)continue;
      for(const end of (finished?['bottom']:['bottom','top'])){
        const [x,z]=lift.points[end==='top'?lift.points.length-1:0];
        const distance=Math.hypot(x-sim.x,z-sim.z);
        if(distance<min){min=distance;best={lift,end};}
      }
    }
    return best;
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
    const w=canvas.clientWidth,h=canvas.clientHeight;
    if(!w||!h)return;
    if(canvas.width!==w||canvas.height!==h){canvas.width=w;canvas.height=h;}
    const subject=photo?site(photoKind):station?.view==='lodge'?site('lodge'):null;
    const x=subject?.x??sim.x, z=subject?.z??sim.z;
    const bearing=yaw, scale=Math.min(w,h)/((station?.view==='valley'?780:320)/zoom);
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
    trace(sim.route.points,night?'#ffc77f':'#a45e23',2.7);
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
    ctx.save();ctx.translate(px,py-Math.min(12,sim.airHeight*12));ctx.rotate(heading);
    ctx.beginPath();ctx.moveTo(0,-13);ctx.lineTo(8,8);ctx.lineTo(0,5);ctx.lineTo(-8,8);ctx.closePath();
    ctx.fillStyle=opts.color;ctx.fill();ctx.lineWidth=2;ctx.strokeStyle='#fff';ctx.stroke();ctx.restore();
    const marker=sim.activeJunction(64);
    if(marker){
      ctx.font='bold 13px sans-serif';ctx.fillStyle=night?'#f9e5be':'#394d56';
      marker.sign.options.forEach((option,index)=>ctx.fillText(label(option.name),15,h*.45+index*20));
    }
    ctx.fillStyle=night?'#cbdce5':'#4e6572';ctx.font='13px sans-serif';
    ctx.fillText(t('轻量雪道视图','Lightweight trail view'),12,h*.34);
  }
  function loop(now){
    frame=0;if(!active||document.hidden)return;
    const dt=last?Math.min(.085,(now-last)/1000):1/30;
    if(last&&!paused&&!photo&&now-last<31){kick();return;}
    last=now;
    if(!paused&&!photo){
      clock+=dt;yaw+=input.lookX*dt*1.75;
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
    draw();if(!paused&&!photo)kick();
  }
  function kick(){if(active&&!frame&&!document.hidden)frame=requestAnimationFrame(loop);}
  function redraw(){draw();kick();}
  window.addEventListener('resize',redraw);
  return {
    flat:true,sim,input,start,stage,trailhead,pushOff,beginRide,leaveRide,
    get conditions(){return conditions;},
    get station(){return station;},
    get nearbyStation(){const near=nearestStation();return near?{name:near.lift.name,end:near.end}:null;},
    get liftInfo(){return ride?{name:ride.lift.name,resort:ride.lift.resort,dir:ride.dir,speed:ride.speed,
      progress:ride.dir>0?ride.along/ride.length:1-ride.along/ride.length}:null;},
    get nextFlag(){return null;},
    get looking(){return Math.abs(yaw)>.03||Math.abs(zoom-1)>.03||station?.view!=='wide'&&!!station;},
    get facing(){return sim.heading+yaw;},
    summitHeading(route){return station?.summit?navigation.summitHeading(station.side,route):undefined;},
    pause(value){paused=value;last=0;redraw();},
    stop(){active=false;if(frame)cancelAnimationFrame(frame);frame=0;sim.mode='idle';canvas.hidden=true;},
    environment(){refreshClimate();redraw();},
    graphics:redraw,
    changeRider(){sim.gear=opts.gear;redraw();},
    cameraChanged:redraw,
    lookAroundStation(name){if(station)station.view=name;redraw();},
    lookAtBaseHall(){const hall=site('hall');if(hall){yaw=-Math.atan2(hall.x-sim.x,sim.z-hall.z);redraw();}},
    centerLook(){yaw=0;zoom=1;panX=panY=0;if(station)station.view='wide';redraw();},
    photo(value,kind='rider'){photo=value;photoKind=kind;if(!value)panX=panY=0;redraw();},
    photoPlace(kind){photoKind=kind;panX=panY=0;redraw();},
    orbit(dx,dy){yaw+=dx*.008;zoom=clamp(zoom*Math.exp(-dy*.003),.55,2.6);redraw();},
    panPhoto(dx,dy,elevation){panX+=dx;panY+=dy+(elevation||0);redraw();},
    zoom(factor){zoom=clamp(zoom/factor,.55,2.6);redraw();},
    capture(){draw();return new Promise(resolve=>canvas.toBlob(resolve,'image/png'));}
  };
}

