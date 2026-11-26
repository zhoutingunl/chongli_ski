import {clamp,lerp,mixAngle} from './mountain.js';
import {physicsStep} from './simulation.js';
import {moveChannels} from './run-moves.js';

const motion=['x','y','z','ground','snowSink','speed','slope','roll','airHeight',
  'edge','edgeRate','curve','pressure','terrainFlex','groundLoad','verticalAlong','upSpeed'];
const bearings=['heading','travelHeading','slipAngle'];
const lane=['along','offset','edgeSpeed'];

// Render the boots, torso, snow contact and tracking camera at the same instant
// between completed physics ticks. Gameplay and the HUD keep the live state.
export class DescentFrames {
  constructor(sim){
    this.sim=sim;
    this.frame=Object.create(sim);
    this.previous={};
    this.previousMoves={};
    this.renderMoves={};
    this.reset();
  }

  reset(){
    this.remainder=0;
    this.ready=false;
  }

  advance(dt,input){
    this.remainder+=dt;
    while(this.remainder>=physicsStep){
      if(this.remainder<2*physicsStep&&this.sim.mode==='run')this.capture();
      this.sim.tick(physicsStep,input);
      this.remainder-=physicsStep;
    }
  }

  capture(){
    const sim=this.sim,prev=this.previous,turns=sim.automatic;
    for(const key of motion)prev[key]=sim[key];
    for(const key of bearings)prev[key]=sim[key];
    for(const key of lane)prev[key]=sim[key];
    prev.guideHeading=sim.guideHeading;
    prev.guided=sim.guided;
    prev.route=sim.route;
    prev.airborne=sim.airborne;
    if(sim.moves)for(const key of moveChannels)this.previousMoves[key]=sim.moves[key];
    if(prev.turns!==turns)this.turns=Object.create(turns);
    prev.turns=turns;
    prev.phase=turns.phase;prev.radius=turns.radius;prev.amplitude=turns.amplitude;
    this.ready=true;
  }

  renderPose(){
    const sim=this.sim,prev=this.previous,frame=this.frame;
    if(!this.ready||sim.mode!=='run')return sim;
    const t=clamp(this.remainder/physicsStep,0,1);
    for(const key of motion)frame[key]=lerp(prev[key],sim[key],t);
    for(const key of bearings)frame[key]=mixAngle(prev[key],sim[key],t);
    frame.airborne=sim.airborne||(prev.airborne&&frame.airHeight>.002);
    if(sim.moves){
      for(const key of moveChannels)this.renderMoves[key]=lerp(this.previousMoves[key],sim.moves[key],t);
      this.renderMoves.side=sim.moves.side;
      frame.moves=this.renderMoves;
    }
    // A fork can change lane coordinates in one tick even though the skier's
    // world position is continuous. Pick up the new route at its own chainage.
    const sameLane=prev.route===sim.route&&prev.guided===sim.guided&&prev.turns===sim.automatic;
    for(const key of lane)frame[key]=sameLane?lerp(prev[key],sim[key],t):sim[key];
    frame.guideHeading=sameLane?mixAngle(prev.guideHeading,sim.guideHeading,t):sim.guideHeading;
    frame.automatic=sim.automatic;
    if(sameLane){
      const turns=this.turns;
      turns.phase=mixAngle(prev.phase,sim.automatic.phase,t);
      turns.radius=lerp(prev.radius,sim.automatic.radius,t);
      turns.amplitude=lerp(prev.amplitude,sim.automatic.amplitude,t);
      frame.automatic=turns;
    }
    return frame;
  }
}
