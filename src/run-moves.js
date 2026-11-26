import {clamp} from './mountain.js';
import {nearbyLiftStation} from './lift-access.js';

const smooth=(lo,hi,value)=>{
  const t=clamp((value-lo)/(hi-lo),0,1);
  return t*t*(3-2*t);
};
const groundMoves=['carve','shortTurns','balance'];
export const moveChannels=[...groundMoves,'preload','airPose'];

// Read the roll and the snow the rider will land on in the current direction
// of travel. A downward break in slope can unload a board even on a groomer.
export function roomToPop(sim,leadSeconds=0){
  const {data,speed,travelHeading}=sim;
  const dx=Math.sin(travelHeading),dz=-Math.cos(travelHeading);
  const x=sim.x+dx*speed*leadSeconds,z=sim.z+dz*speed*leadSeconds;
  const span=clamp(speed*.38,3,7),land=Math.max(span+2,speed*.76);
  const height=d=>data.height(x+dx*d,z+dz*d);
  const here=height(0),before=(height(-span)-here)/span,after=(here-height(span))/span;
  if(after-before<.018 || after>.47 || after<-.035)return false;
  for(const d of [span*.5,span,(span+land)*.5,land]){
    const px=x+dx*d,pz=z+dz*d,near=data.index.near(px,pz);
    if(!near.trail || near.distance>(near.trail.width||36)*.34 ||
      data.obstacles?.contact(px,pz))return false;
  }
  return Math.abs((here-height(land))/land-after)<.16;
}

// All timing is simulation time. Looking around, changing frame rate or
// taking a photo never draws a new move. The line planner uses the same
// continuous turn phase for these variations and for its camera prediction.
export class RunMoves {
  constructor(random=Math.random){
    this.random=random;
    this.reset();
  }

  reset(){
    this.gear=null;this.kind=null;this.last=null;
    this.wait=1.6;this.age=0;this.duration=0;
    this.didPop=false;this.manualAir=false;this.side=1;
    this.rollCheck=0;this.popCooldown=7;
    this.stationCheck=0;this.nearStation=false;
    for(const key of moveChannels)this[key]=0;
  }

  finish(){
    this.kind=null;this.age=0;this.didPop=false;
    this.wait=2.6+this.random()*3.4;
  }

  manualJump(sim,charge){
    if(!sim.opts.variedMoves || charge<.53 || sim.speed<5 || sim.speed>=27 ||
      !sim.onTrail || sim.approach || this.nearStation || sim.route.length-sim.along<55 ||
      sim.activeJunction(40,2))return;
    this.manualAir=true;
    this.side=this.random()<.5?-1:1;
  }

  update(sim,grade,remaining,junction,dt){
    const enabled=sim.opts.variedMoves===true;
    if(!enabled && this.gear===null)return false;
    if(this.gear!==sim.gear)this.reset();
    this.gear=sim.gear;
    const {speed,pisteContact:near,automatic,route}=sim;
    this.stationCheck-=dt;
    if(this.stationCheck<=0){
      this.nearStation=!!sim.data.lifts?.length && !!nearbyLiftStation(sim.data,sim);
      this.stationCheck=.30;
    }
    if(!enabled || Math.abs(sim.steer)>.12 || sim.brake>.12)this.manualAir=false;
    const open=enabled && sim.guided && automatic.handsFree && !automatic.sprint &&
      !this.nearStation && !sim.approach && !sim.requestedTurn && !junction && remaining>48+speed &&
      route.finishKind!=='lift-link' && sim.onTrail && near?.trail &&
      near.distance<(near.trail.width||36)*.41 && (near.trail.width||36)>=21 &&
      sim.snowSoftness<.46 && sim.elapsed-sim.lastTreeHit>2.4 &&
      grade>-.012 && grade<.69 && speed>5.0 && speed<27;
    const ownFlight=this.kind==='pop' && this.didPop && sim.airborne;
    const available=open && (automatic.active || ownFlight);
    this.popCooldown=Math.max(0,this.popCooldown-dt);
    let pop=false;
    if(!available){
      if(this.kind)this.finish();
    }else if(this.kind){
      this.age+=dt;
      if(this.kind==='pop'){
        if(!this.didPop && this.age>=.38){
          if(sim.jumpCooldown===0 && roomToPop(sim)){
            this.didPop=true;pop=true;
          }else this.finish();
        }else if(this.didPop && !sim.airborne)this.finish();
      }else if(this.age>=this.duration)this.finish();
    }else{
      this.wait-=dt;this.rollCheck-=dt;
      // Look ahead while coasting between figures. The crest usually lasts
      // less time than a turn, so waiting for the next random pick misses it.
      if(this.rollCheck<=0 && this.popCooldown===0 && this.last!=='pop'){
        this.rollCheck=.26;
        if(speed>=7.5 && speed<20 && sim.jumpCooldown===0 && sim.contactTime>.7 &&
          sim.snowTerrain?.kind!=='pipe' && roomToPop(sim,.38) && this.random()<.44){
          this.kind='pop';this.last='pop';this.age=0;this.didPop=false;
          this.side=sim.edge<0?-1:1;this.popCooldown=17+this.random()*9;
        }
      }
      if(!this.kind && this.wait<=0)this.pickTurns(sim,grade);
    }
    const strength=this.kind ? smooth(0,.56,this.age)*smooth(0,.68,this.duration-this.age) : 0;
    for(const key of groundMoves){
      const target=this.kind===key ? strength : 0;
      this[key]+=(target-this[key]) * -Math.expm1(-dt*(available?12:20));
    }
    const preparing=this.kind==='pop'&&!this.didPop?smooth(0,.34,this.age):0;
    this.preload+=(preparing-this.preload)*-Math.expm1(-dt*(preparing>this.preload?18:22));
    return pop;
  }

  pickTurns(sim,grade){
    const speed=sim.speed;
    const board=sim.gear==='board',options=['carve','shortTurns'];
    if(speed<18.5 && grade<.38)options.push('balance');
    const choices=options.filter(move=>move!==this.last);
    this.kind=choices[Math.floor(this.random()*choices.length)];
    this.last=this.kind;this.age=0;this.didPop=false;
    this.side=sim.edge<0?-1:1;
    // Leave time to ride both edges, particularly on a fast, long arc.
    const period=2*Math.PI*sim.automatic.radius/Math.max(speed,1);
    this.duration=this.kind==='balance' ? (board?2.35:3.4) : clamp(period*1.25,4.3,8)+this.random();
  }

  flight(sim,dt){
    let shape=0;
    if(!sim.airborne)this.manualAir=false;
    if((this.didPop || this.manualAir) && sim.airborne){
      // Relative velocity gives time to meet the local surface, including
      // landings lower than the takeoff. Square the board before touchdown.
      const v=sim.upSpeed-sim.verticalAlong;
      const left=(v+Math.sqrt(v*v+19.62*sim.airHeight))/9.81;
      shape=smooth(.03,.18,sim.airHeight)*smooth(.06,.23,left)*smooth(.025,.15,sim.airTime);
    }
    this.airPose=sim.airborne?this.airPose+(shape-this.airPose)*-Math.expm1(-dt*26):0;
  }
}
