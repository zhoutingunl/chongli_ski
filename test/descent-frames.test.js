import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {prepareMountain} from '../src/mountain.js';
import {Descent,physicsStep} from '../src/simulation.js';
import {DescentFrames} from '../src/descent-frames.js';

const mountain=prepareMountain(JSON.parse(readFileSync(new URL('../public/assets/geo/mountain.json',import.meta.url))));
const route=mountain.routes.find(r=>r.id==='genting-classic');
function onPeony(){
  const sim=new Descent(mountain,{gear:'ski',assist:true});
  sim.start(route);
  while(sim.trail?.name!=='芍药花'&&sim.mode==='run'&&sim.elapsed<100)sim.tick(physicsStep);
  assert.equal(sim.trail.name,'芍药花');
  return sim;
}

test('芍药花追尾在 30、60、120 帧和漏帧时都显示对应时刻的滑手、雪面和回转轨迹',()=>{
  const ref=onPeony();
  const fields=['x','z','y','ground','speed','along','offset','edgeSpeed','curve','edgeRate'];
  const ticks=[];
  for(let i=0;i<=182;i++){
    ticks.push(fields.map(key=>ref[key]));
    ref.tick(physicsStep);
  }
  for(const intervals of [[1/30],[1/60],[1/120],[.031,.035,.029,.036,.050,.017]]){
    const sim=onPeony(),frames=new DescentFrames(sim);
    let time=0,i=0;
    while(time<2){
      const dt=Math.min(2-time,intervals[i++%intervals.length]);
      frames.advance(dt,{});time+=dt;
      const live=[sim.x,sim.z,sim.offset,sim.automatic.phase];
      const shown=frames.chasePose();
      const when=Math.max(0,time/physicsStep-1),k=Math.floor(when);
      fields.forEach((key,j)=>{
        const expected=ticks[k][j]+(ticks[k+1][j]-ticks[k][j])*(when-k);
        assert.ok(Math.abs(shown[key]-expected)<1e-7,`${key} at ${time}s`);
      });
      assert.deepEqual([sim.x,sim.z,sim.offset,sim.automatic.phase],live);
      assert.equal(frames.chasePose().x,shown.x);
    }
  }
});

test('跨越角度零点、岔路切换与索道重出发时，追尾使用正确的转向和道内坐标',()=>{
  const sim=onPeony(),frames=new DescentFrames(sim);
  const before=sim.x;
  sim.heading=Math.PI-.02;sim.automatic.phase=2*Math.PI-.03;
  frames.advance(1.5*physicsStep,{});
  sim.heading=-Math.PI+.02;sim.automatic.phase=.03;
  let pose=frames.chasePose();
  assert.ok(Math.abs(Math.sin(pose.heading))<1e-8&&Math.cos(pose.heading)<0);
  assert.ok(Math.abs(Math.sin(pose.automatic.phase))<1e-8&&Math.cos(pose.automatic.phase)>0);
  assert.ok(Math.abs(pose.x-(before+sim.x)/2)<1e-8);

  const next=mountain.routes.find(r=>r.id==='genting-valley');
  sim.joinLine(next,31);
  pose=frames.chasePose();
  assert.equal(pose.route,next);assert.equal(pose.along,31);
  assert.equal(pose.offset,sim.offset);assert.equal(pose.automatic,sim.automatic);
  sim.mode='lift';
  assert.equal(frames.chasePose(),sim);
  sim.start(next);frames.reset();
  assert.equal(frames.remainder,0);
  assert.deepEqual([frames.chasePose().x,frames.chasePose().z],next.points[0]);
});

test('手动起跳后雪板落回同一帧的雪面，换刃和落地事件由物理只结算一次',()=>{
  const sim=onPeony(),frames=new DescentFrames(sim),landings=sim.feedback.landing;
  assert.ok(sim.jump());
  let peak=0,delayedContact=false;
  for(let i=0;i<360;i++){
    frames.advance(1/120,{steer:.25});
    const pose=frames.chasePose();
    peak=Math.max(peak,pose.airHeight);
    if(!sim.airborne&&pose.airHeight>.002){
      delayedContact=true;
      assert.equal(pose.airborne,true);
    }
    if(pose.airHeight>.01)assert.ok(Math.abs(pose.y-pose.ground-pose.airHeight)<.003);
  }
  assert.ok(peak>.08&&delayedContact);
  assert.equal(frames.chasePose().airborne,false);
  assert.equal(sim.feedback.landing,landings+1);
  assert.ok(sim.steer>.20);
});
