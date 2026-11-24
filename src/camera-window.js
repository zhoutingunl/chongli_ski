import {clamp} from './mountain.js';

const laneFrequency=11;

export function usesCameraWindow(sim,input) {
  return !!(sim.mode==='run' && sim.guided && !sim.airborne && sim.automatic?.handsFree &&
    !input.lookX && !input.lookY && Math.abs(input.steer||0)<.055 && Math.abs(input.trim||0)<.085 &&
    !input.brake && !input.boost && !sim.charging);
}

export function cameraWindowMetres(fov, aspect, depth) {
  return clamp(Math.tan(fov*Math.PI/360)*aspect*depth*.25,.15,3.25);
}

// Average two consecutive chords. As the skier approaches a mapped corner,
// the outgoing chord starts rotating the view before the skis reach the vertex.
export function previewGlide(sim) {
  const speed=sim.speed*Math.cos(sim.slope*Math.PI/180);
  const span=clamp(8+speed*.85,9,32);
  const a=sim.route.at(sim.along-span*.55);
  const b=sim.route.at(sim.along+span*.45);
  const c=sim.route.at(sim.along+span*1.45);
  const dx=.60*(b.x-a.x)+.40*(c.x-b.x), dz=.60*(b.z-a.z)+.40*(c.z-b.z);
  const course=Math.hypot(dx,dz)>.01 ? Math.atan2(dx,-dz) : sim.guideHeading;
  const lead=2/laneFrequency;
  const lane=sim.automatic.offsetAfter(lead,speed,sim.offset,sim.edgeSpeed);
  const rideBearing=course+Math.atan2(lane-sim.offset,Math.max(1,speed*lead));
  return {course,rideBearing,lane};
}

export class GlideCamera {
  heading=0;
  turnRate=0;
  lane=0;
  laneRate=0;

  reset(heading,lane){
    this.heading=heading;
    this.turnRate=0;
    this.lane=lane;
    this.laneRate=0;
  }

  aim(bearing,dt){
    const error=Math.atan2(Math.sin(bearing-this.heading),Math.cos(bearing-this.heading));
    const acceleration=clamp(25*error-10*this.turnRate,-2.2,2.2);
    const rate=clamp(this.turnRate+acceleration*dt,-1.35,1.35);
    this.heading+=(this.turnRate+rate)*.5*dt;
    this.turnRate=rate;
    return this.heading;
  }

  followLane(prediction,margin,dt){
    // Ease into the edge of the framing window. A critically damped spring
    // follows the predicted exit, carrying its velocity through the next turn.
    const outside=Math.max(0,Math.abs(prediction)-margin),width=margin*.23;
    const beyond=outside<width ? outside*outside/(2*width) : outside-width*.5;
    const target=Math.sign(prediction)*beyond;
    const offset=this.lane-target,slope=this.laneRate+laneFrequency*offset;
    const decay=Math.exp(-laneFrequency*dt);
    this.lane=target+(offset+slope*dt)*decay;
    this.laneRate=(this.laneRate-laneFrequency*slope*dt)*decay;
    return this.lane;
  }
}
