import {clamp,mixAngle} from './mountain.js';

export class Descent {
  constructor(data,opts) {
    this.data=data;this.opts=opts;this.mode='idle';this.gear=opts.gear;this.speed=0;this.x=this.z=this.heading=this.y=this.steer=this.brake=this.airHeight=0;
  }
  start(route) {
    this.route=route;this.along=0;this.offset=0;this.edgeSpeed=0;this.elapsed=0;this.travel=0;
    this.airHeight=this.upSpeed=0;this.slope=0;this.turn=0;this.steer=0;this.brake=0;this.boost=0;
    const f=route.frame(0);this.x=f.x;this.z=f.z;this.heading=f.angle;
    this.y=this.ground=this.startY=this.data.height(this.x,this.z);
    this.speed=3.2;this.maxSpeed=this.speed;this.mode='run';this.jumpCooldown=0;this.forkTaken=false;
    this.planIndex=0;this.freeAge=0;this.elapsedDrop=0;this.surface();
  }
  surface() {
    const near=this.data.index.near(this.x,this.z);
    this.onTrail=!!near.trail&&near.distance<(near.trail.width||36)*.58;
    const leg=this.route.legs?.find(l=>l.endIndex>this.planIndex) || this.route.legs?.at(-1);
    this.trail=this.onTrail?near.trail:null;
    if(this.opts.assist && Math.abs(this.offset)<9 && leg){this.trail=this.data.trails.find(t=>t.id===leg.trailId)||this.trail;this.onTrail=true;}
  }
  jump(){if(this.mode==='run'&&this.airHeight<=.025&&this.jumpCooldown<=0){this.upSpeed=3.7+Math.min(1.3,this.speed*.05);this.airHeight=.015;this.jumpCooldown=.85;}}
  setAssist(on){
    if(!this.route || this.mode!=='run')return;
    if(on){
      const pos=this.route.closest(this.x,this.z),f=this.route.frame(pos.along);this.along=pos.along;
      this.offset=-(this.x-f.x)*f.dz+(this.z-f.z)*f.dx;this.edgeSpeed=0;
    }
  }
  switchRoute(route) {
    const nearest=route.closest(this.x,this.z);if(nearest.distance>64)return false;
    const f=route.frame(nearest.along);this.offset=-(this.x-f.x)*f.dz+(this.z-f.z)*f.dx;
    this.route=route;this.along=nearest.along;this.planIndex=f.index;this.forkTaken=true;return true;
  }
  get fork(){
    if(this.forkTaken||!this.route?.id.endsWith('classic'))return null;
    const there=this.route.resort==='wanlong'?'genting':'wanlong';
    const alt=this.data.routes.find(r=>r.id===this.route.resort+'-to-'+there);
    if(!alt)return null;
    const a=this.route.points,b=alt.points;let i=0;
    while(i+1<Math.min(a.length,b.length)&&a[i+1][0]===b[i+1][0]&&a[i+1][1]===b[i+1][1])i++;
    const ahead=this.route.distances[i]-this.along;
    return ahead>=-5&&ahead<155?{route:alt,ahead:Math.max(0,ahead)}:null;
  }
  tick(dt,input) {
    if(this.mode!=='run')return;
    this.gear=this.opts.gear;this.elapsed+=dt;this.jumpCooldown=Math.max(0,this.jumpCooldown-dt);
    this.steer+=(input.steer-this.steer)*(1-Math.exp(-dt*6.5));this.brake+=(Number(input.brake)-this.brake)*(1-Math.exp(-dt*9));
    this.boost+=(Number(input.boost)-this.boost)*(1-Math.exp(-dt*6));
    const oldX=this.x,oldZ=this.z,oldY=this.ground;
    const fx=Math.sin(this.heading),fz=-Math.cos(this.heading),peek=5;
    let grade=(this.data.height(oldX-fx*peek,oldZ-fz*peek)-this.data.height(oldX+fx*peek,oldZ+fz*peek))/(2*peek);
    grade=clamp(grade,-.38,1.08);
    const speed=this.speed,assist=this.opts.assist;
    const tuck=this.boost>.2?1:0;
    const push=(speed<4.0&&this.brake<.1?1.0:0)+this.boost*2.6;
    const gravity=9.81*grade/Math.sqrt(1+grade*grade);
    const drag=(this.onTrail?.26:.86)+(this.gear==='board'?.006:.0054)*(tuck?.72:1)*speed*speed+Math.abs(this.steer)*(.23+.045*speed);
    if(this.airHeight<=.02)this.speed=clamp(speed+(gravity+push-drag-this.brake*(5.4+.28*speed))*dt,0,tuck?34:31);
    if(this.brake<.08&&this.speed<2.25&&assist)this.speed=Math.min(2.25,this.speed+.98*dt);
    this.maxSpeed=Math.max(this.maxSpeed,this.speed);
    const dist=this.speed*dt/Math.sqrt(1+grade*grade);
    if(assist){
      const old=this.route.frame(this.along);
      this.edgeSpeed+=(this.steer*Math.min(this.speed*.65,10)-this.edgeSpeed)*(1-Math.exp(-dt*3.8));
      const width=(this.trail?.width||38)*.5+7;
      const correction=Math.abs(this.offset)>width?Math.sign(this.offset)*(Math.abs(this.offset)-width)*1.1:0;
      this.offset+=(this.edgeSpeed-correction)*dt;
      this.along=Math.min(this.route.length,this.along+dist*(1-.18*Math.abs(this.steer)));
      const f=this.route.frame(this.along);this.planIndex=f.index;
      this.x=f.x-f.dz*this.offset;this.z=f.z+f.dx*this.offset;
      const desired=f.angle+Math.atan2(this.edgeSpeed,Math.max(3,this.speed));
      this.heading=mixAngle(this.heading,desired,1-Math.exp(-dt*(Math.abs(f.angle-old.angle)>.3?5:3.6)));
    }else{
      this.heading+=this.steer*dt*(this.gear==='board'?1.29:1.46)*(.45+.55*clamp(this.speed/7,0,1))*(this.airHeight>.08?.55:1);
      this.x+=Math.sin(this.heading)*dist;this.z-=Math.cos(this.heading)*dist;
      const b=this.data.bounds;this.x=clamp(this.x,b.minX+8,b.maxX-8);this.z=clamp(this.z,b.minZ+8,b.maxZ-8);
      this.freeAge+=dt;
      if(this.freeAge>.18){const c=this.route.closest(this.x,this.z);this.along=c.along;this.planIndex=this.route.at(c.along).index;this.freeAge=0;}
    }
    if((!assist||Math.abs(this.offset)>9)&&this.airHeight<1.4){
      const hit=this.data.obstacles?.contact(this.x,this.z);
      if(hit){
        this.x=hit.x;this.z=hit.z;this.speed*=.37;this.edgeSpeed=0;
        if(assist){const f=this.route.frame(this.along);this.offset=-(this.x-f.x)*f.dz+(this.z-f.z)*f.dx;}
        else{const inward=Math.min(0,fx*hit.nx+fz*hit.nz);this.heading=Math.atan2(fx-1.3*inward*hit.nx,-(fz-1.3*inward*hit.nz));}
      }
    }
    this.ground=this.data.height(this.x,this.z);
    if(this.airHeight>0){this.upSpeed-=9.81*dt;this.airHeight=Math.max(0,this.airHeight+this.upSpeed*dt);if(!this.airHeight)this.upSpeed=0;}
    this.y=this.ground+this.airHeight;this.travel+=Math.hypot(this.x-oldX,this.z-oldZ,this.ground-oldY);
    this.slope+=(Math.atan(grade)*180/Math.PI-this.slope)*(1-Math.exp(-dt*4));this.surface();
    const end=this.route.points.at(-1);
    if(this.along>=this.route.length-1.6 && Math.hypot(this.x-end[0],this.z-end[1])<56){
      this.mode='finished';this.speed=0;this.airHeight=0;this.y=this.ground;
    }
  }
}
