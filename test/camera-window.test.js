import assert from 'node:assert/strict';
import test from 'node:test';
import {GlideCamera,cameraWindowMetres,previewGlide,usesCameraWindow} from '../src/camera-window.js';
import {AutomaticTurns} from '../src/automatic-turns.js';
import {SkiRoute} from '../src/mountain.js';

test('中央横移范围按视野计算，范围内镜头不平移，越界时逐渐跟随',()=>{
  const margin=cameraWindowMetres(61,.52,16),camera=new GlideCamera();
  assert.ok(margin>1.20&&margin<1.25);
  assert.equal(cameraWindowMetres(61,1.8,16),3.25);
  assert.equal(cameraWindowMetres(40,.5,1),.15);
  for(const position of [.3,.55,-.9,.8])assert.equal(camera.followLane(position,margin,1/60),0);
  const first=camera.followLane(4.8,margin,1/60);
  assert.ok(first>0&&first<.06);
  for(let i=0;i<150;i++)camera.followLane(4.8,margin,1/60);
  assert.ok(4.8-camera.lane>margin&&4.8-camera.lane<margin*1.2);
  assert.ok(Math.abs(camera.laneRate)<.001);
});

test('沿路线预看弯道，进入拐点前已经开始转动，两侧方向连续',()=>{
  const route=new SkiRoute({points:[[0,0],[0,-80],[80,-80]]},{height:()=>0});
  const state={route,speed:16,slope:0,automatic:new AutomaticTurns(),offset:0,edgeSpeed:0};
  const course=along=>previewGlide({...state,along}).course;
  assert.equal(course(10),0);
  assert.ok(course(66)>0&&course(79)>course(66));
  assert.ok(Math.abs(course(80.01)-course(79.99))<.002);
  assert.ok(Math.abs(course(115)-Math.PI/2)<.001);
});

test('回转预测接续实测板速和侧移，在换刃前预见反方向的位移',()=>{
  const a=new AutomaticTurns(),speed=18,offset=3.85,lateral=.15;
  a.radius=12;a.phase=Math.PI/2-.025;a.amplitude=4;
  assert.equal(a.offsetAfter(0,speed,offset,lateral),offset);
  const derivative=(a.offsetAfter(.00001,speed,offset,lateral)-offset)/.00001;
  assert.ok(Math.abs(derivative-lateral)<.001);
  assert.ok(a.offsetAfter(.27,speed,offset,lateral)<offset);
  assert.equal(a.phase,Math.PI/2-.025);
});

test('跨北向和急弯均限制镜头角速度与角加速度，不同帧率收敛到同一朝向',()=>{
  for(const rate of [23,30,60,120]){
    const c=new GlideCamera(),dt=1/rate;
    c.reset(Math.PI-.03,0);
    const start=c.heading;
    const target=-Math.PI+.8;
    for(let i=0;i<rate*3;i++){
      const prev=c.turnRate;c.aim(target,dt);
      assert.ok(Math.abs(c.turnRate-prev)<=2.2*dt+1e-9);
      assert.ok(Math.abs(c.turnRate)<=1.35);
    }
    assert.ok(c.heading>start);
    assert.ok(Math.abs(c.heading-(target+Math.PI*2))<.002);
  }
});

test('自动状态经过岔口或冲刺时持续，手动转向、加速、刹车、环顾与起跳立即接管',()=>{
  const sim={mode:'run',guided:true,automatic:new AutomaticTurns()};
  sim.automatic.idle=3;
  assert.equal(usesCameraWindow(sim,{}),true);
  for(const field of ['sprint','active']){
    sim.automatic[field]=true;assert.equal(usesCameraWindow(sim,{}),true);
  }
  for(const input of [{steer:.10},{boost:true},{brake:true},{lookX:1},{trim:.3}]){
    assert.equal(usesCameraWindow(sim,input),false);
  }
  for(const state of [{charging:true},{airborne:true},{guided:false},{mode:'lift'}]){
    assert.equal(usesCameraWindow({...sim,...state},{}),false);
  }
  sim.automatic.update({steer:.8},15,true,false,false,1/60);
  assert.equal(usesCameraWindow(sim,{}),false);
});
