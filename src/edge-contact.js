// Groomed twin skis. Positions are in world metres; left and right are the skier's.
import {Vector3} from 'three';

const clamp=(x,min,max)=>Math.min(max,Math.max(min,x));
const smooth=(a,b,x)=>{const t=clamp((x-a)/(b-a),0,1);return t*t*(3-2*t);};

export function skiLoad(leg,edge,pressure) {
  return .5-leg*Math.sign(edge)*.39*smooth(.04,.70,Math.abs(edge))*clamp(pressure,0,1);
}

export function biteDepth(load,pressure,softness,scale) {
  return scale*(.0018+load*(.003+.009*clamp(pressure,0,1))+.005*clamp(softness,0,.5));
}

export function surfaceNormal(height,point,out,span=.12) {
  return out.set(height(point.x-span,point.z)-height(point.x+span,point.z),2*span,
    height(point.x,point.z-span)-height(point.x,point.z+span)).normalize();
}

export function newSkiContact(leg) {
  return {leg,normal:new Vector3(),left:new Vector3(),right:new Vector3(),boot:new Vector3(),
    fore:new Vector3(),rear:new Vector3(),nose:new Vector3(),across:new Vector3(),forward:new Vector3(),
    weight:0,active:false,clearance:0,edgeRise:0,edgeAngle:0};
}

// A flat ski seats on its base. Blend across the waist while changing edge so the
// contact does not teleport from one rail to the other at zero roll.
export function edgeFraction(rise,width) {
  return .5-.5*clamp(rise/(width*.20),-1,1);
}

export function cutResponse(foot,previous,dt,speed,width) {
  const {rear,across}=foot,old=previous.rear;
  const measured=((rear.x-old.x)*across.x+(rear.y-old.y)*across.y+(rear.z-old.z)*across.z)/Math.max(dt,.0001);
  const sideSpeed=clamp(measured,-speed,speed);
  const slip=clamp(Math.abs(sideSpeed)/Math.max(speed,.5),0,1);
  const tilt=Math.min(1,Math.abs(Math.sin(foot.edgeAngle)));
  const edgeWidth=width*(1-.82*tilt);
  const spray=clamp(foot.weight*(.10*tilt+.155*Math.abs(sideSpeed)),0,1.32);
  return {sideSpeed,slip,edgeWidth,spray};
}
