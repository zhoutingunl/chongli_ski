// Local piste traffic uses metres, seconds and the same centreline frames as Descent.
const clamp=(x,low,high)=>Math.min(high,Math.max(low,x));
const ease=x=>{const t=clamp(x,0,1);return t*t*(3-2*t);};
export const crowdColours=['#ca553e','#307ea1','#e0a432','#4c977c','#ac5883','#495fa4'];
export function daylightTraffic(night){
  const daylight=1-clamp(night,0,1);
  return {skiers:2+Math.round(5*daylight),chat:daylight>.36,seatChance:.14+.54*daylight};
}

export function passengerManifest(random,seatCount){
  return Array.from({length:seatCount},()=>({ticket:random(),coat:Math.floor(random()*crowdColours.length),scale:.84+random()*.16}));
}

// A contact is tested over both riders' motion, including crossings between ticks.
export function passingDistance(ax,az,bx,bz,other){
  const rx=ax-other.prevX,rz=az-other.prevZ;
  const dx=bx-other.x-rx,dz=bz-other.z-rz;
  const t=clamp(-(rx*dx+rz*dz)/(dx*dx+dz*dz||1),0,1);
  return Math.hypot(rx+t*dx,rz+t*dz);
}

export function collisionPose(age,released){
  if(age==null)return {recoil:0,reach:0,loose:0,turn:0};
  const recoil=Math.sin(Math.PI*ease(age/.58));
  if(!released)return {recoil,reach:0,loose:0,turn:0};
  // The loose deck coasts out, then is drawn under the boot before the rider stands up.
  const loose=ease(age/.68)*(1-ease((age-1.65)/1.12));
  const reach=ease((age-.39)/.68)*(1-ease((age-2.8)/.62));
  return {recoil,loose,reach,turn:loose*(1+.10*Math.sin(age*4.3))};
}

export class PisteTraffic {
  constructor(data,random=Math.random){
    this.data=data;this.random=random;this.night=0;this.reset();
  }
  reset(keepGuests=false){
    if(!keepGuests){this.actors=[];this.route=null;this.nextId=1;this.nextGroup=0;}
    this.playerHit=null;this.cooldown=0;this.pass=null;this.patrol=0;this.manualTime=0;
  }
  make(route,along,baseLane,seated=false,partnerSide=0){
    const frame=route.glideFrame(along),trail=this.data.index.near(frame.x,frame.z).trail;
    if(!trail)return null;
    const half=clamp((trail.width||36)*.43,3,20);
    const a={id:this.nextId++,route,along,baseLane:clamp(baseLane,-.8,.8),seated,partnerSide,
      gear:seated||this.random()<.39?'board':'ski',pace:seated?0:5+this.random()*7,
      phase:this.random()*Math.PI*2,period:.50+this.random()*.36,amplitude:half*(.09+this.random()*.15),
      half,coat:Math.floor(this.random()*crowdColours.length),scale:.82+this.random()*.21,
      lane:0,reaction:null,opacity:0,age:0,checkAlong:along,avoid:0,yieldLane:0,yieldSide:0};
    this.place(a,0);
    if(this.data.obstacles?.contact(a.x,a.z,.9))return null;
    return a;
  }
  place(a,dt){
    const f=a.route.glideFrame(a.along),wave=Math.sin(a.phase);
    const oldX=a.x,oldZ=a.z;
    a.lane=a.baseLane*a.half+(a.seated?a.partnerSide*1.12:a.amplitude*wave+a.avoid+a.yieldLane);
    a.lane=clamp(a.lane,-a.half*.94,a.half*.94);
    a.fx=f.dx;a.fz=f.dz;
    a.x=f.x-f.dz*a.lane;a.z=f.z+f.dx*a.lane;
    a.prevX=oldX??a.x;a.prevZ=oldZ??a.z;
    a.vx=dt?(a.x-a.prevX)/dt:0;a.vz=dt?(a.z-a.prevZ)/dt:0;
    a.heading=a.seated?f.angle-a.partnerSide*1.32:
      Math.abs(a.vx)+Math.abs(a.vz)>.05?Math.atan2(a.vx,-a.vz):(a.heading??f.angle);
    a.lean=a.seated?0:-wave*.38;
  }
  populate(sim){
    const r=sim.route;
    if(!r||r.length<40||r.finishKind==='lift-link')return;
    const density=daylightTraffic(this.night);
    const start=Math.max(3,(r.approach?.endDistance||0)+2),end=r.length-14;
    const fresh=this.route!==r;this.route=r;
    // Keep people already in view on their original branch when the player changes route.
    this.actors=this.actors.filter(a=>a.along<a.route.length-4&&Math.hypot(a.x-sim.x,a.z-sim.z)<295);
    const movers=this.actors.filter(a=>!a.seated&&!a.retire);
    for(const a of movers.slice(density.skiers))if(Math.hypot(a.x-sim.x,a.z-sim.z)>36)a.retire=true;
    for(let i=movers.length;i<density.skiers;i++){
      const behind=!fresh&&i%3===0&&sim.along>start+48;
      const offset=fresh?16+i*19+this.random()*12:behind?-32-this.random()*27:75+this.random()*110;
      const along=Math.max(start,sim.along+offset);
      if(along>end||Math.abs(along-sim.along)<10)continue;
      const lane=(i%2?1:-1)*(.09+this.random()*.50);
      if(this.actors.some(a=>a.route===r&&Math.abs(a.along-along)<6&&Math.abs(a.baseLane-lane)<.48))continue;
      const a=this.make(r,along,lane);
      if(a)this.actors.push(a);
    }
    const seated=this.actors.filter(a=>a.seated&&!a.retire);
    if(!density.chat){for(const a of seated)if(Math.hypot(a.x-sim.x,a.z-sim.z)>32)a.retire=true;}
    else if(!seated.length&&this.nextGroup<=0){
      const along=Math.max(start+7,sim.along+(fresh?49:82)+this.random()*44);
      if(along<end-8){
        const lane=(this.random()<.5?-1:1)*.52;
        const pair=[-1,1].map(side=>this.make(r,along+.35*side,lane,true,side));
        if(pair.every(Boolean))this.actors.push(...pair);
      }
      this.nextGroup=3;
    }
  }
  advance(dt,sim){
    this.cooldown=Math.max(0,this.cooldown-dt);this.nextGroup-=dt;this.patrol-=dt;
    if(this.playerHit){
      this.playerHit.age+=dt;
      if(this.playerHit.age>=(this.playerHit.released?3.45:.69))this.playerHit=null;
    }
    if(this.patrol<=0||this.route!==sim.route){this.populate(sim);this.patrol=.56;}
    for(const a of this.actors){
      a.age+=dt;a.opacity=clamp(a.opacity+(a.retire?-1:1)*dt*1.8,0,1);
      let speed=a.pace;
      if(a.reaction){
        a.reaction.age+=dt;
        if(a.reaction.age>(a.reaction.released?3.45:.69))a.reaction=null;
        else speed*=a.reaction.released?0:.24+.6*ease(a.reaction.age/.7);
      }
      if(!a.seated){
        const before=a.along;
        a.along=Math.min(a.route.length,a.along+speed*dt);
        if(a.along-a.checkAlong>9){
          const f=a.route.glideFrame(a.along);
          const w=this.data.index.near(f.x,f.z).trail?.width;
          if(w)a.half=clamp(w*.43,3,20);
          a.checkAlong=a.along;
        }
        a.phase+=a.period*dt*(speed/a.pace);
        // Other riders also leave room around a seated pair or a slower rider.
        let target=0;
        for(const o of this.actors){
          const gap=o.along-before;
          if(o!==a&&o.route===a.route&&gap>=-1.5&&gap<12&&o.pace<a.pace&&Math.abs(o.lane-a.baseLane*a.half)<3.4){
            target=(o.lane>=a.baseLane*a.half?-1:1)*3.5;break;
          }
        }
        a.avoid+=(target-a.avoid)*(1-Math.exp(-2.2*dt));
        // A moving rider can also give a passing skier room, especially in a group.
        const dx=sim.x-a.x,dz=sim.z-a.z,longitudinal=dx*a.fx+dz*a.fz;
        const lateral=-dx*a.fz+dz*a.fx;
        const yielding=sim.mode==='run'&&sim.guided&&!this.manualTime&&
          Math.abs(longitudinal)<12+Math.abs(sim.speed-a.pace)*1.6&&Math.abs(lateral)<7;
        let yieldTarget=0;
        if(yielding){
          const playerLane=a.lane+lateral;
          if(!a.yieldSide)a.yieldSide=Math.abs(lateral)>.05?-Math.sign(lateral):a.lane>0?1:-1;
          if(Math.abs(playerLane+a.yieldSide*3.3)>a.half*.93)a.yieldSide=playerLane>=0?-1:1;
          const wanted=playerLane+a.yieldSide*3.3-a.baseLane*a.half-a.amplitude*Math.sin(a.phase)-a.avoid;
          yieldTarget=a.yieldSide*clamp(a.yieldSide*wanted,0,6);
        }else a.yieldSide=0;
        a.yieldLane+=clamp((yieldTarget-a.yieldLane)*2.2,-3.8,3.8)*dt;
      }
      this.place(a,dt);
    }
    this.actors=this.actors.filter(a=>!a.retire||a.opacity>0);
  }
  avoidance(sim,lane,width,speed){
    // Predict the catch in world space, including a skier overtaking a slow player.
    const f=sim.route.glideFrame(sim.along),rx=-f.dz,rz=f.dx;
    const threats=[];
    for(const a of this.actors){
      if(a.opacity<.25)continue;
      const dx=a.x-sim.x,dz=a.z-sim.z;
      const ahead=dx*f.dx+dz*f.dz,across=sim.offset+dx*rx+dz*rz;
      const closing=speed-a.vx*f.dx-a.vz*f.dz;
      const time=Math.abs(closing)>.6?ahead/closing:Math.abs(ahead)<8?0:Infinity;
      if(time<-.45||time>3.4||Math.abs(ahead)>78||Math.abs(across-sim.offset)>width+3)continue;
      const predicted=across+clamp(time,0,1.10)*(a.vx*rx+a.vz*rz);
      const left=Math.min(across,predicted)-3.8,right=Math.max(across,predicted)+3.8;
      threats.push({id:a.id,left,right,time:Math.max(0,time)});
    }
    if(!threats.length){this.pass=null;return null;}
    threats.sort((a,b)=>a.time-b.time);
    const lead=threats.find(o=>o.id===this.pass?.id||Math.max(sim.offset,lane)>o.left-.5&&Math.min(sim.offset,lane)<o.right+.5);
    if(!lead){this.pass=null;return null;}
    const limit=width*.90;
    // Consider the whole group; choosing the nearest side of just one rider can
    // steer straight into their neighbour. Prefer a stable side through an overtake.
    const candidates=[lane,sim.offset,-limit,limit];
    for(const o of threats)candidates.push(o.left-.45,o.right+.45);
    let target=lane,minimum=Infinity;
    for(const candidate of candidates){
      const x=clamp(candidate,-limit,limit),side=x<(lead.left+lead.right)*.5?-1:1;
      let cost=.77*Math.abs(x-sim.offset)+.36*Math.abs(x-lane);
      if(this.pass?.id===lead.id&&this.pass.side!==side)cost+=3.8;
      for(const o of threats){
        const overlap=Math.min(x-o.left,o.right-x);
        if(overlap>0)cost+=(12+25*overlap)/(1+o.time*.75);
      }
      if(cost<minimum){minimum=cost;target=x;}
    }
    this.pass={id:lead.id,side:target<(lead.left+lead.right)*.5?-1:1};
    return target;
  }
  clearLane(sim,frame,width){
    // Apply a final ski-length clearance in a pinch (e.g. converging carves);
    // union overlapping intervals so clearing one rider cannot clip the next.
    const radius=1.68,rx=-frame.dz,rz=frame.dx;
    const x=frame.x+sim.branchShiftX,z=frame.z+sim.branchShiftZ;
    let intervals=null;
    for(const a of this.actors){
      if(a.opacity<.25)continue;
      const dx=a.x-x,dz=a.z-z;
      if(Math.abs(dx-rx*sim.offset)>5||Math.abs(dz-rz*sim.offset)>5)continue;
      const forward=dx*frame.dx+dz*frame.dz;
      if(Math.abs(forward)>=radius)continue;
      const cross=dx*rx+dz*rz,span=Math.sqrt(radius*radius-forward*forward);
      (intervals??=[]).push([cross-span,cross+span]);
    }
    if(!intervals)return sim.offset;
    let left=sim.offset,right=sim.offset;
    for(const [lo,hi] of intervals.sort((a,b)=>a[0]-b[0]))if(lo<=right&&right<hi)right=hi;
    for(let i=intervals.length-1;i>=0;i--){
      const [lo,hi]=intervals[i];if(lo<left&&left<=hi)left=lo;
    }
    if(left< -width)return right;
    if(right>width)return left;
    return sim.offset-left<right-sim.offset?left:right;
  }
  contact(sim,oldX,oldZ,dt,manual){
    if(!manual||this.cooldown>0||!sim.onTrail||sim.airHeight>.90)return null;
    for(const a of this.actors){
      if(a.opacity<.7||a.reaction||passingDistance(oldX,oldZ,sim.x,sim.z,a)>(a.seated?1.08:.88))continue;
      const relative=Math.hypot((sim.x-oldX)/dt-a.vx,(sim.z-oldZ)/dt-a.vz);
      if(relative<1.25)continue;
      const released=relative>9&&(relative>15||this.random()<.58);
      const side=(sim.x-a.x)*Math.cos(sim.heading)+(sim.z-a.z)*Math.sin(sim.heading)>=0?1:-1;
      this.playerHit={age:0,released,side};a.reaction={age:0,released,side:-side};
      this.cooldown=released?4.8:2.1;
      return this.playerHit;
    }
    return null;
  }
}
