import {clamp,mixAngle} from './mountain.js';

export function usesCameraWindow(sim,input) {
  return !!(sim.mode==='run'&&sim.guided&&sim.automatic?.active&&sim.automatic.amplitude>.12&&
    !input.lookX&&!input.lookY&&Math.abs(input.steer||0)<.055&&Math.abs(input.trim||0)<.085&&
    !input.brake&&!input.boost&&!sim.charging);
}

export function keepInWindow(anchor, position, margin) {
  return clamp(anchor,position-margin,position+margin);
}

export function easeCameraLane(anchor,position,margin,dt) {
  const target=keepInWindow(anchor,position,margin);
  const lane=anchor+(target-anchor)*-Math.expm1(-16*dt);
  return keepInWindow(lane,position,margin*1.45);
}

export function turnCameraAtBend(bearing, trailBearing, margin) {
  const delta=Math.atan2(Math.sin(trailBearing-bearing),Math.cos(trailBearing-bearing));
  return mixAngle(bearing,trailBearing,Math.abs(delta)>margin ? 1-margin/Math.abs(delta) : 0);
}

export function cameraWindowMetres(fov, aspect, depth) {
  // Leave the skier free to move across roughly the middle half of the
  // view. The same screen area covers fewer metres on narrower screens.
  return clamp(Math.tan(fov*Math.PI/360)*aspect*depth*.50,.30,6.5);
}
