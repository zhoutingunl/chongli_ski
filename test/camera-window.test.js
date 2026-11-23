import assert from 'node:assert/strict';
import test from 'node:test';
import {cameraWindowMetres,easeCameraLane,keepInWindow,turnCameraAtBend,usesCameraWindow} from '../src/camera-window.js';

test('自动回转镜头保留画面缓冲区，越界后只跟随超出的距离',()=>{
  const allowance=cameraWindowMetres(61,.52,16);
  assert.ok(allowance>2&&allowance<3);
  let anchor=0;
  for(const rider of [.6,1.1,-1.8,1.6])anchor=keepInWindow(anchor,rider,allowance);
  assert.equal(anchor,0);
  anchor=keepInWindow(anchor,4.8,allowance);
  assert.equal(anchor,4.8-allowance);
  assert.equal(keepInWindow(anchor,4.2,allowance),anchor);
  assert.equal(keepInWindow(anchor,-2,allowance),allowance-2);
  assert.ok(cameraWindowMetres(61,1.8,16)>allowance);
});

test('镜头只在雪道转向超过容许角度时改变方位，跨过北向缝也保持连续',()=>{
  const close=Math.PI-.04;
  assert.equal(turnCameraAtBend(close,-Math.PI+.03,.12),close);
  assert.equal(turnCameraAtBend(0,.25,.12),.13);
});

test('越界跟随渐入，手动转向、加速、刹车和环顾立即交回原镜头',()=>{
  const margin=2.4;
  assert.equal(easeCameraLane(0,1.5,margin,1/60),0);
  const first=easeCameraLane(0,3,margin,1/60);
  assert.ok(first>0&&first<3-margin);
  assert.ok(6-easeCameraLane(0,6,margin,1/60)<=margin*1.45);
  const sim={mode:'run',guided:true,automatic:{active:true,amplitude:4}};
  assert.equal(usesCameraWindow(sim,{}),true);
  for(const input of [{steer:.10},{boost:true},{brake:true},{lookX:1},{trim:.3}]){
    assert.equal(usesCameraWindow(sim,input),false);
  }
});
