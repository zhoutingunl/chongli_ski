import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {prepareMountain} from '../src/mountain.js';
import {Descent} from '../src/simulation.js';
import {createPisteProgress} from '../src/piste-progress.js';
import {placePisteLights,LIGHT_EDGE_CLEARANCE} from '../src/piste-lighting.js';

const data=prepareMountain(JSON.parse(readFileSync(new URL('../public/assets/geo/mountain.json',import.meta.url),'utf8')));

for(const [id,piste,entry] of [['wanlong-to-genting','山丹丹','6l'],['genting-to-wanlong','翠菊花','6k']]){
  test(piste+'联滑线按实际经过的连接道点亮，线路名、单道卡和跨雪场标记同步',()=>{
    const route=data.routes.find(r=>r.id===id),single=data.pisteRoutes.find(r=>r.id==='genting-piste-'+entry);
    const progress=createPisteProgress(data,[]),sim=new Descent(data,{gear:'ski',assist:true});
    const key='genting/'+piste;
    sim.start(route);
    assert.deepEqual(progress.forRoute(route),{ridden:0,total:1});
    while(!sim.splits.completed.some(part=>part.key===key)&&sim.mode==='run'&&sim.elapsed<260)sim.tick(.2,{});
    assert.ok(progress.finishDiscoveries(sim.splits).includes(key));
    for(const row of [route,single])assert.deepEqual(progress.forRoute(row),{ridden:1,total:1});
    assert.equal(progress.status('wanlong',{name:piste+' · 至云顶'}),'visited');
    assert.deepEqual(progress.finishDiscoveries(sim.splits),[]);
    const legacy=createPisteProgress(data,['link/'+piste+'（连接道）']);
    assert.deepEqual(legacy.forRoute(route),{ridden:1,total:1});
    assert.equal(legacy.totals().ridden,1);
  });
}

test('清除标记不重放本趟已完成的分段，重滑可再次探索，撤销可同时保留新标记',()=>{
  const progress=createPisteProgress(data,['genting/山丹丹']),run=new Descent(data,{assist:true,gear:'ski'});
  run.start(data.routes[0]);run.splits.add('wanlong/金龙道',80,6);run.splits.finish();
  progress.finishDiscoveries(run.splits);
  const undo=progress.clear(101);assert.equal(progress.totals().ridden,0);
  assert.deepEqual(progress.finishDiscoveries(run.splits),[]);
  assert.equal(createPisteProgress(data,progress.snapshot()).totals().ridden,0);
  run.splits.add('wanlong/玉龙道',90,7);run.splits.finish();
  assert.deepEqual(progress.finishDiscoveries(run.splits),['wanlong/玉龙道']);
  progress.merge(undo);assert.equal(progress.totals().ridden,3);
  const previous=progress.clear(101);assert.ok(previous.pistesResetAt>undo.pistesResetAt);
  progress.merge(undo);assert.equal(progress.totals().ridden,0);
  run.splits.add('wanlong/金龙道',76,6);run.splits.finish();
  assert.deepEqual(progress.finishDiscoveries(run.splits),['wanlong/金龙道']);
});

test('可从已有滑程快照恢复已探索的雪道',()=>{
  const progress=createPisteProgress(data,[]);
  const visits=new Map([['gold',{id:'w259702567',key:'wanlong/金龙道',metres:200}]]);
  assert.ok(progress.observe(visits));
  assert.equal(progress.observe(visits),false);
  assert.equal(progress.totals().ridden,1);
});

test('首次滑出金龙才结算探索，重复经过、刷新和云端恢复均不重复提示',()=>{
  const progress=createPisteProgress(data,['genting/芍药花']);
  const run=new Descent(data,{assist:true,gear:'ski'});
  const fresh=()=>progress.finishDiscoveries(run.splits);
  const status=()=>progress.status('wanlong',{name:'金龙道'});
  const gold=data.routes.find(r=>r.id==='wanlong-gold');
  run.start(gold);
  for(let i=0;i<500;i++)run.tick(1/90,{boost:true});
  assert.equal(status(),'new');assert.deepEqual(fresh(),[]);
  while(!run.splits.completed.length&&run.elapsed<180)run.tick(.10,{boost:true});
  assert.deepEqual(fresh(),['wanlong/金龙道']);assert.equal(status(),'visited');
  assert.deepEqual(fresh(),[]);assert.equal(progress.totals('wanlong').ridden,1);
  const restored=createPisteProgress(data,[...progress.completed]);
  assert.deepEqual(restored.finishDiscoveries(run.splits),[]);
  run.splits.add('genting/芍药花',60,6);run.splits.finish();
  assert.ok(!fresh().includes('genting/芍药花'));
  assert.equal(progress.status('wanlong',{name:'虚构道口'}),null);
});

test('夜滑灯杆位于全部雪道宽度之外，金龙与玉龙的交汇处也遵守净空',()=>{
  const lights=placePisteLights(data);
  assert.ok(lights.length>50);
  const jade=data.trails.find(t=>t.name==='玉龙道'), gold=data.trails.find(t=>t.name==='金龙道');
  const fork=gold.points.find(point=>jade.points.some(other=>other.join(',')===point.join(',')));
  assert.ok(fork);
  assert.ok(lights.some(l=>Math.hypot(l.x-fork[0],l.z-fork[1])<130));
  for(const {x,z} of lights){
    for(const t of data.index.corridors(x,z,38)){
      assert.ok(t.distance>=t.trail.width*.5+LIGHT_EDGE_CLEARANCE);
    }
  }
});

test('山脚累计探索率与两座雪场地图的统计使用同一目录',()=>{
  const progress=createPisteProgress(data,['wanlong/金龙道','genting/芍药花','wanlong/过期旧道名']);
  const wanlong=progress.totals('wanlong'),genting=progress.totals('genting');
  assert.equal(wanlong.ridden,1);assert.equal(genting.ridden,1);
  assert.deepEqual(progress.totals(),{ridden:2,total:wanlong.total+genting.total});
});

test('金龙接玉龙途中按实际滑程结算，山脚续滑和缆车停计，下趟重新起算',()=>{
  const sim=new Descent(data,{gear:'ski',assist:true});
  const route=data.routes.find(r=>r.id==='wanlong-gold');
  sim.start(route);
  while(!sim.splits.completed.length&&sim.elapsed<90)sim.tick(.25,{boost:true});
  assert.equal(sim.mode,'run');
  assert.deepEqual(sim.splits.completed.map(p=>p.name),['金龙道']);
  const gold=sim.splits.completed[0];
  assert.ok(gold.distance>800&&gold.average>0);
  while(sim.mode==='run'&&sim.elapsed<180)sim.tick(.25,{boost:true});
  assert.equal(sim.mode,'finished');
  assert.deepEqual(sim.splits.completed.map(p=>p.name),['金龙道','玉龙道']);
  const splitTotals=sim.splits.completed.reduce((a,p)=>[a[0]+p.distance,a[1]+p.seconds],[0,0]);
  assert.ok(Math.abs(splitTotals[0]-sim.travel)<.01);
  assert.ok(Math.abs(splitTotals[1]-sim.elapsed)<.02);
  const before=sim.travel;
  assert.ok(sim.continueAtBase());
  while(sim.mode==='run'&&sim.elapsed<260)sim.tick(.25,{boost:true});
  assert.equal(sim.mode,'finished');
  assert.equal(sim.splits.completed.at(-1).name,'娇龙道');
  assert.ok(sim.travel>before);
  sim.splits.finish();
  const completed=JSON.stringify(sim.splits.completed),distance=sim.travel;
  sim.mode='lift';sim.tick(10,{boost:true});
  assert.equal(sim.travel,distance);
  assert.equal(JSON.stringify(sim.splits.completed),completed);
  sim.start(route);
  assert.deepEqual(sim.splits.completed,[]);
  assert.equal(sim.travel,0);
});
