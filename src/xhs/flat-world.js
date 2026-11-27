import {outfitFor} from '../wardrobe.js';
import {LiftHelmet} from '../lift-helmet.js';
import {nearbyLiftStation} from '../lift-access.js';
import {Descent} from '../simulation.js';
import {PisteTraffic,crowdColours,collisionPose,daylightTraffic,passengerManifest} from '../piste-traffic.js';
import {GlideCamera,previewGlide,usesCameraWindow} from '../camera-window.js';
import {createSkiNavigation} from '../navigation.js';
import {createMountainClimate} from '../environment.js';
import {clamp,difficultyColor} from '../mountain.js';
import {label,t} from '../language.js';

// A top-down marker preserves direction on the trail map while showing the
// same equipment, leading foot and helmet identity as the mountain view.
function drawRiderMarker(ctx,opts,sim,x,y,heading,removed) {
  const gear=opts.gear, child=opts.gender==='boy'||opts.gender==='girl', female=opts.gender==='female'||opts.gender==='girl';
  const pace=Math.min(1,Math.max(0,sim.speed/22)), edge=sim.edge||0, brake=sim.brake||0;
  const moves=sim.mode==='run'?sim.moves:null;
  const carve=(moves?.carve||0)*edge, balance=moves?.balance||0;
  const outline='#344850', deck=child?'#b5d4cb':'#dfc69b';
  const look=outfitFor(opts.gender,opts.color), helmet=look.helmet;
  function line(x1,y1,x2,y2,ink,width) {
    ctx.strokeStyle=ink;ctx.lineWidth=width;ctx.beginPath();ctx.moveTo(x1,y1);ctx.lineTo(x2,y2);ctx.stroke();
  }
  function oval(cx,cy,rx,ry,angle,ink){
    ctx.save();ctx.translate(cx,cy);ctx.rotate(angle);ctx.scale(rx,ry);
    ctx.beginPath();ctx.arc(0,0,1,0,Math.PI*2);ctx.fillStyle=ink;ctx.fill();ctx.restore();
  }
  ctx.save();ctx.translate(x,y-Math.min(12,(sim.airHeight||0)*12));ctx.rotate(heading);
  if(child)ctx.scale(.83,.83);
  const hit=sim.traffic?.playerHit,pose=collisionPose(hit?.age,hit?.released),side=hit?.side||1;
  if(gear==='board'){
    ctx.save();ctx.translate(side*pose.loose*10,-pose.loose*4);ctx.rotate(side*pose.turn*.57);
    const deckAngle=-edge*.065+(moves?.airPose||0)*(moves?.side||1)*.50;
    oval(0,0,4.7,15-balance*2,deckAngle,outline);oval(0,0,3.5,13.8-balance*2,deckAngle,deck);
    line(-2.5,-3,2,-5,outline,2.4);line(-2,4,2.7,5,outline,2.4);ctx.restore();
  }else for(const s of [-1,1]){
    ctx.save();
    if(s===side){ctx.translate(side*pose.loose*10,-pose.loose*4);ctx.rotate(side*pose.turn*.57);}
    const toe=s*(3.4-(child?1.6:.7)*brake);
    const advance=balance*Math.max(0,s*edge)*4;
    line(s*(3.4+brake),10-advance,toe,-15-advance,outline,3.3);line(s*(3.4+brake),10-advance,toe,-15-advance,deck,1.7);ctx.restore();
  }
  const tilt=gear==='board'?.80-edge*.22:edge*.18;
  ctx.translate(carve*3+side*pose.recoil*3,(gear==='board'?balance*2:0)-pose.reach*2);
  ctx.save();ctx.translate(edge*1.35,0);ctx.rotate(tilt);
  const width=child?5.2:5.6,arm=width+2+Math.abs(edge)*(child?3:1.8);
  for(const s of [-1,1]){
    const tap=(moves?.shortTurns||0)*Math.max(0,s*Math.cos(sim.automatic?.phase||0))**4;
    const tip=s*(arm+Math.abs(carve)*3.2-pose.reach*4),front=-2.8-pose.reach*4-2.8*pace+s*edge*2.5-(gear==='ski'?tap*3:0);
    line(s*width,-1,tip,front,outline,2.8);
    if(gear!=='board')line(tip,front,tip+s*(2-.8*pace),front+8+6*pace,'#607378',.95);
  }
  oval(0,0,width+1.0,4.9,0,outline);oval(0,0,width,4.2,0,look.coat);
  if(child&&!female)oval(0,1.8,2.7,2.6,0,'#30394b');
  if(female)for(const side of (child?[-1,1]:[0]))oval(side*2.8,2.0,child?1.2:1.7,2.7,0,'#55392e');
  ctx.restore();
  const headY=-3.6-2.6*pace,hr=child?4.5:4.0;
  if(removed>0)oval(edge*.65,headY,hr*.89,hr*.93,0,'#4f382f');
  const hx=removed*6.8,hy=removed*5.8-Math.sin(Math.PI*removed)*2.4;
  ctx.translate(hx,hy);
  if(opts.gender==='girl')for(const side of [-1,1])oval(side*3.2,headY-3,1.65,1.65,0,helmet);
  oval(edge*.65,headY,hr+.6,hr+.8,0,outline);oval(edge*.65,headY,hr,hr+.22,0,helmet);
  line(-hr*.55+edge*.65,headY-2.1,hr*.55+edge*.65,headY-2.1,'#4e8392',1.3);
  ctx.restore();
}

// Project the same polygons used by the collision index in the lightweight view.
export function drawBuildingFootprints(ctx,buildings,position,scale,w,h,night){
  ctx.fillStyle=night?'#455269':'#c0b5a4';
  ctx.strokeStyle=night?'#8390a2':'#857967';
  ctx.lineWidth=1;
  ctx.beginPath();
  for(const {x,z,radius,footprint} of buildings){
    const [cx,cy]=position(x,z),r=radius*scale;
    if(cx+r<0||cx-r>w||cy+r<0||cy-r>h)continue;
    ctx.moveTo(...position(...footprint[0]));
    for(let i=1;i<footprint.length;i++)ctx.lineTo(...position(...footprint[i]));
    ctx.closePath();
  }
  ctx.fill();ctx.stroke();
}

export function createFlatWorld(canvas,data,opts,onEvent,climate=createMountainClimate(),pisteProgress) {
  const helmet=new LiftHelmet();
  const ctx=canvas.getContext('2d');
  if(!ctx)throw new Error('Canvas 2D is unavailable');
  canvas.hidden=false;
  const sim=new Descent(data,opts), navigation=createSkiNavigation(data);
  const buildings=data.buildings.filter(b=>b.footprint.length>=3).map(({x,z,footprint})=>({
    x,z,footprint,radius:Math.max(...footprint.map(([px,pz])=>Math.hypot(px-x,pz-z)))
  }));
  const input={steer:0,trim:0,brake:false,boost:false,lookX:0,lookY:0};
  let station=null,ride=null,paused=false,active=false,videoCanvasLocked=false;
  let yaw=0,zoom=1,panX=0,panY=0,frame=0,last=0,hudAge=0,snowMarks=[];
  const glideCamera=new GlideCamera();
  let previewRoute=null,mapHeading=0,lookUntil=0;
  sim.traffic=new PisteTraffic(data);
  let conditions=climate.sample(opts.time,opts.weather);
  const refreshClimate=()=>{conditions=climate.sample(opts.time,opts.weather);sim.traffic.night=conditions.nightAmount;};
  function gates(route,at,side,lift,end='top',summit=false){
    sim.start(route);Object.assign(sim,{mode:summit?'summit':'station',x:at.position[0],z:at.position[1],heading:at.heading,travelHeading:at.heading,trail:null});
    sim.y=sim.ground=sim.startY=data.height(sim.x,sim.z);
    sim.upperGuide=at.guide;station={side,lift,end,summit,guide:at.guide,view:'wide'};ride=null;resetView();draw();kick();
  }
  function stage(route,arrivalLift){
    helmet.reset();
    const place=data.summitPlaces[route.resort];
    const lift=arrivalLift||data.lifts.find(l=>l.id===place.liftId);
    gates(route,place,route.resort,lift,place.stationEnd,true);
  }
  function resetView(){
    previewRoute=null;lookUntil=0;canvas.hidden=false;active=true;paused=false;last=0;yaw=0;zoom=1;panX=panY=0;snowMarks=[];
  }
  function start(route,keepGuests=false){helmet.reset();
    sim.start(navigation.safeRun(route),keepGuests);refreshClimate();station=ride=null;resetView();draw();kick();
  }
  function trailhead(route){
    helmet.reset();
    const point=route.frame(0);
    gates(route,{position:[point.x,point.z],heading:point.angle},route.resort);
    station.trailhead=true;sim.mode='trailhead';
  }
  function pushOff(turn=0,preferred,heading){
    if(!station)return null;
    const angle=Number.isFinite(heading)?heading:sim.heading+yaw+turn;
    const guide=station.guide;
    const route=station.trailhead&&!turn?sim.route:navigation.departure(station.side,sim.x,sim.z,angle,preferred,guide);
    if(!route)return null;
    start(route,true);sim.upperGuide=guide;if(!Number.isFinite(heading))sim.freeHeading(guide?route.frame(0).angle:angle);sim.speed=2.15;
    return sim.route;
  }
  function nearestStation(){
    if(station?.lift)return {lift:station.lift,end:station.end};
    return nearbyLiftStation(data,sim);
  }
  function beginRide(){
    const here=nearestStation();
    if(!here)return false;
    helmet.board();sim.splits.finish();
    const {lift,end}=here;
    const line=[];
    for(let i=1;i<lift.points.length;i++){
      const [x,z]=lift.points[i-1], [bx,bz]=lift.points[i];
      const length=Math.hypot(bx-x,bz-z);
      line.push({x,z,bx,bz,length});
    }
    const length=line.reduce((sum,part)=>sum+part.length,0);
    ride={lift,line,length,along:end==='top'?length:0,dir:end==='top'?-1:1,speed:5.8,passengers:passengerManifest(Math.random,3),seatChance:daylightTraffic(conditions.nightAmount).seatChance};
    station=null;sim.mode='lift';sim.speed=0;paused=false;last=0;kick();return true;
  }
  function leaveRide(){
    if(!ride)return;
    helmet.unload();
    const {lift,dir}=ride,side=lift.resort,end=dir<0?'bottom':'top';
    const route=data.routes.find(r=>r.id===side+'-classic');
    if(end==='top'){climate.arriveUpperStation(opts.time);refreshClimate();}
    const place=end==='top'&&navigation.upperStation(lift);
    if(place)gates(place.route,place,side,lift,end,navigation.isSummitStation(lift));
    else {
      const position=navigation.stationExit(lift,end);
      const point=lift.points[end==='top'?lift.points.length-1:0];
      gates(route,{position,heading:Math.atan2(point[0]-position[0],position[1]-point[1])},side,lift,end);
    }
    onEvent('disembark',{side,route:sim.route,mode:sim.mode,end});
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
  function draw(dt=0){
    if(!active||!sim.route)return;
    const w=videoCanvasLocked?canvas.width:canvas.clientWidth,h=videoCanvasLocked?canvas.height:canvas.clientHeight;
    if(!w||!h)return;
    if(canvas.width!==w||canvas.height!==h){canvas.width=w;canvas.height=h;}
    const subject=station?.view==='lodge'?site('lodge'):null;
    let x=subject?.x??sim.x, z=subject?.z??sim.z;
    const headingUp=(sim.mode==='summit'||sim.mode==='run');
    const scale=Math.min(w,h)/((station?.view==='valley'?780:320)/zoom);
    const plan=performance.now()>=lookUntil&&usesCameraWindow(sim,input)?previewGlide(sim):null;
    if(plan){
      if(!previewRoute)glideCamera.reset(mapHeading,sim.offset);
      else if(previewRoute!==sim.route){glideCamera.lane=sim.offset;glideCamera.laneRate=0;}
      mapHeading=glideCamera.aim(plan.course,dt);
      const shift=glideCamera.followLane(plan.lane,Math.min(9,w/(8*scale)),dt)-sim.offset;
      x+=Math.cos(sim.guideHeading)*shift;z+=Math.sin(sim.guideHeading)*shift;
    }else mapHeading=sim.heading;
    previewRoute=plan?sim.route:null;
    const bearing=headingUp?-(mapHeading+yaw):yaw;
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
    drawBuildingFootprints(ctx,buildings,position,scale,w,h,night);
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
    for(const guest of sim.traffic.actors){
      const [ax,ay]=position(guest.x,guest.z);
      if(ax<0||ay<0||ax>w||ay>h)continue;
      ctx.save();ctx.translate(ax,ay);ctx.rotate(guest.heading+bearing);ctx.globalAlpha=guest.opacity;
      const contact=collisionPose(guest.reaction?.age,guest.reaction?.released);
      ctx.strokeStyle='#243344';ctx.lineWidth=guest.gear==='ski'?1:2.2;
      const boardX=contact.loose*5;
      for(const side of guest.gear==='ski'?[-1,1]:[0]){
        const edge=side*1.6+boardX;ctx.beginPath();ctx.moveTo(edge,-4);ctx.lineTo(edge,4);ctx.stroke();
      }
      ctx.fillStyle=crowdColours[guest.coat];ctx.beginPath();ctx.arc(0,guest.seated?2:0,2.7,0,Math.PI*2);ctx.fill();
      ctx.restore();
    }
    const [px,py]=position(sim.x,sim.z), heading=sim.heading+bearing;
    if(ride){
      ctx.fillStyle=night?'#a4b2c1':'#4a6172';ctx.fillRect(px-12,py-6,24,12);
      const chance=ride.seatChance;
      const places=[-8,2,8];
      ride.passengers.forEach((guest,i)=>{
        if(guest.ticket>=chance)return;
        ctx.fillStyle=crowdColours[guest.coat];ctx.beginPath();ctx.arc(px+places[i],py,2.4,0,Math.PI*2);ctx.fill();
      });
      ctx.fillStyle=outfitFor(opts.gender,opts.color).coat;ctx.beginPath();ctx.arc(px-3,py,2.5,0,Math.PI*2);ctx.fill();
    }else drawRiderMarker(ctx,opts,sim,px,py,heading,helmet.progress);
    const marker=navigation.nearbyChoices(sim);
    if(marker){
      ctx.save();ctx.font='bold 13px sans-serif';ctx.textAlign='center';ctx.lineWidth=3;
      ctx.fillStyle=night?'#f9e5be':'#204857';ctx.strokeStyle=night?'#253044':'#f3f4e8';
      const placed=[];
      for(const opt of marker.options){
        const anchor=opt.paintPosition||opt.position;
        if(!anchor)continue;
        const [ax,ay]=position(...anchor),forward=mapHeading+yaw;
        const view=Math.atan2(anchor[0]-sim.x,sim.z-anchor[1]);
        if(Math.cos(view-forward)<.28||ax<8||ax>w-8||ay<10||ay>h-16)continue;
        const status=marker.type==='summit'&&pisteProgress?.status(marker.resort,opt);
        const text=(status==='new'?(opts.language==='en'?'NEW · ':'未滑过 · '):status==='visited'?'✓ ':'')+label(opt.name)+(opt.destination?' → '+label(opt.destination):'');
        ctx.fillStyle=status==='new'?(night?'#ffd57a':'#9b4219'):(night?'#f9e5be':'#204857');
        const width=ctx.measureText(text).width;
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
      climate.advance(dt,opts.time,opts.weather,sim.mode==='run');yaw+=input.lookX*dt*1.75;
      const waiting=helmet.update(dt,sim,input,data,conditions.resolvedTime);
      sim.traffic.night=conditions.nightAmount;
      if(sim.mode!=='run'||waiting)sim.traffic.advance(dt,sim);
      if(ride)moveLift(dt);
      else if(sim.mode==='run'&&!waiting){
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
    draw(paused?0:dt);if(!paused)kick();
  }
  function kick(){if(active&&!frame&&!document.hidden)frame=requestAnimationFrame(loop);}
  function redraw(){draw();kick();}
  window.addEventListener('resize',redraw);
  return {
    flat:true,sim,input,start,stage,trailhead,pushOff,beginRide,leaveRide,
    beforeDeparture:ready=>helmet.beforeDeparture(ready),
    photoFrame(){draw();return canvas;},
    lockVideoCanvas(){
      videoCanvasLocked=true;canvas.classList.add('video-frame-locked');
      return ()=>{videoCanvasLocked=false;canvas.classList.remove('video-frame-locked');redraw();};
    },
    get conditions(){return conditions;},
    get station(){return station;},
    continueAtBase(line){
      if(!sim.continueAtBase(line,this.facing))return false;
      resetView();draw();kick();return true;
    },
    recoverToPiste(){
      if(!sim.recoverToPiste())return false;
      yaw=0;snowMarks=[];redraw();return true;
    },
    get nearbyStation(){const near=nearestStation();return near?{name:near.lift.name,end:near.end}:null;},
    get liftInfo(){return ride?{name:ride.lift.name,resort:ride.lift.resort,dir:ride.dir,speed:ride.speed,
      progress:ride.dir>0?ride.along/ride.length:1-ride.along/ride.length}:null;},
    get nextFlag(){return null;},
    get looking(){return Math.abs(yaw)>.03||Math.abs(zoom-1)>.03||station?.view!=='wide'&&!!station;},
    get facing(){return mapHeading+yaw;},
    pushTowardsView(){sim.freeHeading(this.facing);yaw=0;redraw();},
    summitHeading(route){if(station?.guide)return station.guide.options.find(o=>o.routeId===route)?.selectionHeading;return station?.summit?navigation.summitHeading(station.side,route):undefined;},
    pause(value){paused=value;last=0;redraw();},
    stop(){helmet.reset();active=false;if(frame)cancelAnimationFrame(frame);frame=0;sim.mode='idle';canvas.hidden=true;},
    environment(){refreshClimate();redraw();},
    graphics:redraw,
    changeRider(){sim.gear=opts.gear;redraw();},
    cameraChanged:redraw,
    lookAroundStation(name){if(station)station.view=name;redraw();},
    lookAtBaseHall(){const hall=site('hall');if(hall){yaw=-Math.atan2(hall.x-sim.x,sim.z-hall.z);redraw();}},
    centerLook(){yaw=0;zoom=1;panX=panY=0;if(station)station.view='wide';redraw();},
    orbit(dx,dy){lookUntil=performance.now()+480;yaw+=dx*.008;zoom=clamp(zoom*Math.exp(-dy*.003),.55,2.6);redraw();}
  };
}

