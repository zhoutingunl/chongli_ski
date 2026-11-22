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
    this.visibility=0;
    this.sprint=false;
    this.tuck=0;
  }

  update(input,speed,available,charging,airborne,dt){
    const controlling=Math.abs(input.steer||0)>.055||Math.abs(input.trim||0)>.085||input.brake||charging;
    this.idle=controlling||input.boost ? 0 : Math.min(5,this.idle+dt);
    this.sprint=available&&!controlling&&(speed>sprintSpeed||this.sprint&&speed>=releaseSpeed);
    this.tuck=ease(this.tuck,this.sprint&&!airborne?1:0,controlling?22:9,dt);
    this.active=available&&!airborne&&!this.sprint&&this.idle>=2.6;
    if(!available){
      this.amplitude=ease(this.amplitude,0,15,dt);
      this.visibility=ease(this.visibility,0,9,dt);
    }
  }

  line(speed,halfWidth,grade,crossGrade,routeTurn,clear,dt){
    const slow=1-smooth(5,16,speed);
    const bend=smooth(.065,.46,Math.abs(routeTurn));
    const gradeFactor=(.83+.17*smooth(.015,.23,grade))*(1-.29*smooth(.07,.35,Math.abs(crossGrade)));
    const sweep=(4.8+1.15*slow+bend*(4.4*slow-.88))*gradeFactor;
    const room=halfWidth*(.37+.09*smooth(10,20,halfWidth));
    const amount=this.active ? Math.min(room,sweep)*clear*smooth(2.4,4.8,speed) : 0;
    this.amplitude=ease(this.amplitude,amount,amount>this.amplitude?2.2:(this.active?4.0:15),dt);
    // Higher speed retains a full change of direction with a longer turning
    // radius so that the turn does not demand more edge grip than the skier has.
    const radius=4.6+.54*speed+(1.45+2.9*bend)*slow;
    this.radius=ease(this.radius,Math.max(radius,speed*Math.sqrt(this.amplitude/8.3)),3.6,dt);
    this.visibility=ease(this.visibility,this.active?smooth(.40,3.2,this.amplitude):0,5.8,dt);
    this.phase=(this.phase+speed*dt/this.radius)%tau;
    const arc=this.amplitude*Math.sin(this.phase);
    return {
      offset:arc,
      speed:this.amplitude*Math.cos(this.phase)*speed/this.radius,
      load:-arc*(speed/this.radius)**2/9.81
    };
  }
}
