import assert from 'node:assert/strict';
import test from 'node:test';
import {followSkiTerrain, followTurn, seatSki} from '../src/ski-kinematics.js';
import {ridgeExposure, sunThroughTerrain} from '../src/snow-air.js';

test('左右雪板可各自跨过凸坎和落入凹地，板底不会陷入雪面', () => {
  const left={pitchRelief:0,contactY:0},right={pitchRelief:0,contactY:0};
  const step=1/90;
  followSkiTerrain(left, -.10, .026, .055, .64, .56, step, true);
  followSkiTerrain(right, .07, -.035, -.09, .64, .56, step, true);
  assert.ok(left.bridge>.45);
  assert.equal(right.bridge,0);
  assert.ok(left.pitchRelief<0&&right.pitchRelief>0);
  assert.equal(seatSki(left,.055,step,false),.055);
  const first=seatSki(left,.02,step,false);
  assert.ok(first>.02&&first<.056);
  for(let frame=0;frame<70;frame++)seatSki(left,.02,step,false);
  assert.ok(Math.abs(left.contactY-.02)<.0001);
  assert.ok(seatSki(right,-.09,step,false)<0);
});

test('保持同一刃不会重复点杖，实际换刃触发屈伸和另一侧点杖', () => {
  const cycle={},step=1/90;
  for(let frame=0;frame<95;frame++)followTurn(cycle,.64,.86,1,true,step,frame===0);
  assert.equal(cycle.sign,1);
  assert.equal(cycle.plant,0);
  assert.ok(cycle.press>.8&&cycle.transfer<.01);
  for(let frame=0;frame<14;frame++)followTurn(cycle,.06,.06,1,true,step,false);
  assert.ok(cycle.transfer>.18&&cycle.press<.4);
  assert.equal(cycle.sign,1);
  for(let frame=0;frame<10;frame++)followTurn(cycle,-.62,.8,1,true,step,false);
  assert.equal(cycle.sign,-1);
  assert.ok(cycle.plant>.2&&cycle.transfer>.25);
  for(let frame=0;frame<95;frame++)followTurn(cycle,-.62,.8,1,true,step,false);
  assert.ok(cycle.plant<.005&&cycle.press>.78);
  followTurn(cycle,-.62,.8,1,false,step,false);
  assert.equal(cycle.plant,0);
  assert.equal(cycle.sign,0);
});

test('平地没有山脊风雪源，山脊遮住低角太阳，树冠削弱直射光', () => {
  assert.equal(ridgeExposure(()=>0,0,0),0);
  assert.ok(ridgeExposure((x)=>Math.max(0,7-Math.abs(x-4)*.40),4,0)>.7);
  assert.equal(sunThroughTerrain(x=>x>10 ? 9 : 0,null,0,.3,0,[.995,.10,0]),0);
  const canopy=(x,y)=>x>10&&x<16&&y<8;
  const light=sunThroughTerrain(()=>0,canopy,0,.3,0,[.995,.10,0]);
  assert.ok(light>0&&light<.5);
  assert.equal(sunThroughTerrain(()=>0,canopy,0,.3,0,[0,1,0]),1);
});
