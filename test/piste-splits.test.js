import assert from 'node:assert/strict';
import test from 'node:test';
import {PisteSplits,descentTotals} from '../src/piste-splits.js';

const gold='wanlong/金龙道',jade='wanlong/玉龙道';
test('交汇处短暂碰到另一条雪道不重复结算，确认换道时从新道第一米开始计',()=>{
  const s=new PisteSplits();
  for(const [key,m] of [[gold,50],[jade,5],[gold,5],[jade,6]])s.add(key,m,m/5);
  assert.equal(s.completed.length,0);
  s.add(jade,9,1.8);
  assert.deepEqual(s.completed,[{key:gold,name:'金龙道',distance:60,seconds:12,average:18}]);
  s.finish();
  s.finish();
  assert.equal(s.completed.length,2);
  assert.equal(s.completed[1].distance,15);
  assert.equal(s.completed[1].seconds,3);
});

test('道外滑行和停车不生成雪道，重新滑入同名雪道可记录第二段',()=>{
  const s=new PisteSplits();
  s.add(null,50,10);
  s.add(gold,0,9);
  s.add(gold,30,3);
  s.add(gold,0,2);
  s.add(null,30,5);
  assert.deepEqual(s.completed,[{key:gold,name:'金龙道',distance:30,seconds:5,average:21.6}]);
  s.add(null,80,8);
  s.add(jade,3,.3);
  s.add(null,40,4);
  s.add(gold,20,2);
  s.finish();
  assert.deepEqual(s.completed.map(e=>[e.name,e.distance]),[['金龙道',30],['金龙道',20]]);
});

test('乘缆车看本趟总计，包含无名连接区及停留时间，上车后滑程与最高速冻结',()=>{
  const sim={elapsed:120,travel:1000,maxSpeed:20,speed:0,
    splits:{completed:[{name:'芍药花',distance:240,seconds:19,average:45}]}};
  const total=descentTotals(sim);
  assert.deepEqual(total,{distance:1000,seconds:120,average:30,peak:72});
  sim.y=2100;sim.speed=4.8;sim.mode='lift';
  assert.deepEqual(descentTotals(sim),total);
  assert.deepEqual(descentTotals({travel:0,elapsed:0,maxSpeed:0}),{distance:0,seconds:0,average:0,peak:0});
});
