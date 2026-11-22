import {clamp} from './mountain.js';

const tau=2*Math.PI;
const ease=(from,to,rate,dt)=>from+(to-from)*-Math.expm1(-rate*dt);
const smooth=(lo,hi,x)=>{
  const t=clamp((x-lo)/(hi-lo),0,1);
  return t*t*(3-2*t);
};
const sprintSpeed=100/3.6, releaseSpeed=97.5/3.6;

export class AutomaticTurns {
  constructor(){
    this.idle=0;
    this.phase=0;
    this.amplitude=0;
    this.radius=8;
    this.sprint=false;
    this.tuck=0;
  }

  update(input,speed,available,charging,airborne,dt){
    const controlling=Math.abs(input.steer||0)>.055||Math.abs(input.trim||0)>.085||input.brake||charging;
    this.idle=controlling||input.boost ? 0 : Math.min(5,this.idle+dt);
    this.sprint=available&&!controlling&&(speed>sprintSpeed||this.sprint&&speed>=releaseSpeed);
    this.tuck=ease(this.tuck,this.sprint&&!airborne?1:0,controlling?22:9,dt);
    this.active=available&&!airborne&&!this.sprint&&this.idle>=2.6;
    if(!available)this.amplitude=ease(this.amplitude,0,15,dt);
  }

  line(speed,halfWidth,grade,crossGrade,routeTurn,clear,dt){
    const slow=1-smooth(5,16,speed);
    const bend=smooth(.065,.46,Math.abs(routeTurn));
    const gradeFactor=(.70+.30*smooth(.015,.23,grade))*(1-.31*smooth(.07,.35,Math.abs(crossGrade)));
    const sweep=(2.05+1.52*slow+bend*(3.75*slow-.34))*gradeFactor;
    const amount=this.active ? Math.min(halfWidth*.37,sweep)*clear*smooth(2.4,4.8,speed) : 0;
    this.amplitude=ease(this.amplitude,amount,amount>this.amplitude?2.2:(this.active?4.0:15),dt);
    this.radius=ease(this.radius,4.0+.59*speed+(2.15*bend+1.3)*slow,3.2,dt);
    this.phase=(this.phase+speed*dt/this.radius)%tau;
    const arc=this.amplitude*Math.sin(this.phase);
    return {
      offset:arc,
      speed:this.amplitude*Math.cos(this.phase)*speed/this.radius,
      load:-arc*(speed/this.radius)**2/9.81
    };
  }
}
