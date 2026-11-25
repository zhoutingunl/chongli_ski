import {atWanlongForecourt} from './lift-access.js';

// Progress follows the same hand path in either direction: worn at 0, carried at 1.
const daylight = new Set(['dawn','day','noon','evening','sunset']);
export class LiftHelmet {
  constructor(random = Math.random) { this.random = random; this.reset(); }
  reset() {
    this.progress = 0;
    this.direction = 0;
    this.rest = 0;
    this.tried = false;
    this.aboard = false;
    this.departure = null;
  }
  update(dt,sim,input,data,time) {
    const stopped=!sim.airborne && sim.speed<=.005 &&
      (sim.mode==='finished' || (sim.mode==='run' && input.brake && !input.boost));
    const byLift=stopped && (data.lifts.some(lift=>[lift.points[0],lift.points[lift.points.length-1]].some(
      ([x,z])=>Math.hypot(x-sim.x,z-sim.z)<=70)) || atWanlongForecourt(data,sim.route,sim.x,sim.z));
    if(sim.mode==='run' && !byLift && this.progress)this.beforeDeparture();
    this.advance(dt,byLift,time);
    return sim.mode==='run' && this.progress>0;
  }
  advance(dt, eligible, time) {
    if (this.aboard || dt <= 0) return;
    if (eligible) {
      this.rest += dt;
      if (!this.tried && this.rest >= .65) {
        this.tried = true;
        if (daylight.has(time) && this.random() < .6) this.direction = 1;
      }
    } else if (!this.progress && !this.direction) {
      this.rest = 0; this.tried = false;
    }
    this.progress = Math.max(0, Math.min(1, this.progress + this.direction * dt / 1.55));
    if (this.progress === 1 || this.progress === 0) this.direction = 0;
    if (!this.progress && this.departure) {
      const ready = this.departure;
      this.departure = null;
      ready();
    }
  }
  beforeDeparture(ready) {
    if (!this.progress) return false;
    if (ready && !this.departure) this.departure = ready;
    this.direction = -1;
    return true;
  }
  board() {
    this.aboard = true;
    this.progress = this.progress >= .36 ? 1 : 0;
    this.direction = 0; this.departure = null;
  }
  unload() {
    this.aboard = false; this.tried = true; this.rest = 0;
    this.direction = this.progress ? -1 : 0;
  }
}
