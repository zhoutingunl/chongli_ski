import assert from 'node:assert/strict';
import test from 'node:test';
import {Vector3} from 'three';
import {GlideCamera,cameraWindowMetres,frontCameraTarget,previewGlide,usesCameraWindow} from '../src/camera-window.js';
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

test('横竖屏回转时，漏帧与高刷对同一段匀速横移给出相同的镜头位置和速度',()=>{
  for(const aspect of [393/760,760/393]){
    const margin=cameraWindowMetres(60,aspect,4.3);
    const run=intervals=>{
      const c=new GlideCamera();
      c.followLane(3,margin,0);
      let time=0,i=0;
      while(time<1.2){
        const dt=Math.min(1.2-time,intervals[i++%intervals.length]);time+=dt;
        c.followLane(3+time*4,margin,dt);
      }
      return c;
    };
    const reference=run([1/120]);
    for(const intervals of [[1/30],[1/60],[1/60,1/20,1/30]]){
      const camera=run(intervals);
      assert.ok(Math.abs(camera.lane-reference.lane)<1e-8);
      assert.ok(Math.abs(camera.laneRate-reference.laneRate)<1e-8);
    }
  }
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

test('正面镜头跟随成人和儿童滑手的重心，保留换刃、下蹲和腾空幅度',()=>{
  const track=new Vector3(37,1800,-129);
  const rider={x:38.5,y:1800.3,z:-130,ground:1800.3};
  for(const scale of [1,.68]){
    const eyes=new Vector3(rider.x,rider.y+1.32*scale,rider.z);
    const aim=(path,skier,head)=>frontCameraTarget(new Vector3(),path,skier,head,scale);
    const rest=aim(track,rider,eyes);
    assert.ok(rest.x>track.x&&rest.x<rider.x&&rest.z>rider.z&&rest.z<track.z);
    assert.ok(rest.y>rider.y&&rest.y<eyes.y);
    const lean=new Vector3(.36,-.28,.13).multiplyScalar(scale);
    const change=aim(track,rider,eyes.clone().add(lean)).sub(rest);
    for(const axis of ['x','y','z']){
      const fraction=change[axis]/lean[axis];
      assert.ok(fraction>.4&&fraction<.8);
    }
    const jump=.65;
    const air=aim(track,{...rider,y:rider.y+jump},eyes.clone().add(new Vector3(0,jump,0)));
    assert.ok(air.y-rest.y>jump*.25&&air.y-rest.y<jump*.75);
    const step=new Vector3(9,-2.6,-17);
    const moved={x:rider.x+step.x,y:rider.y+step.y,z:rider.z+step.z,ground:rider.ground+step.y};
    assert.ok(aim(track.clone().add(step),moved,eyes.clone().add(step)).distanceTo(rest.clone().add(step))<1e-8);
  }
});

test('正面自动跟拍经过小跳时保持路线参考，环顾与手动操作立即接管',()=>{
  const sim={mode:'run',guided:true,airborne:true,automatic:new AutomaticTurns()};
  sim.automatic.idle=4;
  assert.equal(usesCameraWindow(sim,{}),false);
  assert.equal(usesCameraWindow(sim,{},true),true);
  for(const input of [{steer:-.8},{lookX:1},{lookY:-1},{boost:true},{brake:true},{trim:.4}]){
    assert.equal(usesCameraWindow(sim,input,true),false);
  }
  for(const change of [{guided:false},{mode:'lift'},{charging:true},{automatic:{handsFree:false}}]){
    assert.equal(usesCameraWindow({...sim,...change},{},true),false);
  }
});
