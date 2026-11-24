import test from 'node:test';
import assert from 'node:assert/strict';
import {mergeSkiProgress,activityTotals,ActivityMeter,rankScore,rankValue} from '../src/ski-engagement.js';
import {PisteSplits} from '../src/piste-splits.js';

const gold='wanlong/金龙道',jade='wanlong/玉龙道',known=new Set([gold,jade]);
const legacy={sessionId:'same-descent',when:'2026-11-24T00:00:00Z',routeId:'wanlong-classic',dist:2000};

test('旧存档按同一趟较长的里程迁移，重复同步、续滑和新版记录不重复记账',()=>{
  const local={records:[legacy],pistes:[gold]},longer={...legacy,dist:2910};
  const other={pistes:[gold,jade],records:[longer,{...legacy,when:'next',sessionId:'next',activityTracked:true,dist:400}]};
  const merged=mergeSkiProgress(local,[other]);
  assert.deepEqual(mergeSkiProgress(merged,[other,local,merged]),merged);
  assert.deepEqual(activityTotals(merged.activity,known).metres,2910);
  assert.equal(activityTotals(merged.activity,known).count,2);
});

test('重复滑同一条道、道外滑程、提前上缆车和山脚续滑都按实际增量累计',()=>{
  const meter=new ActivityMeter(),state=mergeSkiProgress({}).activity;
  const s={splits:new PisteSplits(),travel:0};
  for(const [key,m] of [[gold,42],[jade,5],[gold,20],[jade,44],[null,28],[gold,60]]){
    s.splits.add(key,m,m/5);s.travel+=m;meter.sample(state,'A',s);
  }
  s.splits.finish();meter.sample(state,'A',s,true);meter.sample(state,'A',s,true);
  const first=activityTotals(state,known);
  assert.equal(first.count,3);assert.equal(first.metres,199);assert.equal(first.pistes[0].share,2/3);
  s.travel+=140;meter.sample(state,'A',s,true);
  assert.equal(activityTotals(state,known).count,3);assert.equal(activityTotals(state,known).metres,339);
  s.splits=new PisteSplits();s.travel=22;s.splits.add(jade,22,6);meter.sample(state,'A',s,true);
  assert.equal(activityTotals(state,known).count,4);assert.equal(activityTotals(state,known).metres,361);
});

test('超过一百趟仍有生涯总量，多设备合并重试不重复且不会回滚已有进度',()=>{
  const activity=mergeSkiProgress({}).activity,meter=new ActivityMeter();
  for(let i=0;i<150;i++)meter.sample(activity,'A',{travel:300,splits:{passages:[gold]}},true);
  const b=mergeSkiProgress({}).activity;
  meter.sample(b,'B',{travel:125,splits:{passages:[jade]}},true);
  const a={activity},old={activity:{devices:{A:{metres:100,visits:{[gold]:1}}}}};
  const merged=mergeSkiProgress({activity:b},[old,a,a]);
  assert.deepEqual(mergeSkiProgress(merged,[old,a,{activity:b}]),merged);
  const {metres,count}=activityTotals(merged.activity,known);assert.equal(metres,45125);assert.equal(count,151);
});

test('公开探索榜可区分全部64档，将旧整数计时分排除；次数榜保留实际次数',()=>{
  for(let i=1;i<=64;i++){
    const s=rankScore('explore',i,64,0);
    assert.ok(s>999999&&s<=1000000);
    assert.ok(Math.abs(rankValue('explore',s)-i*100/64)<1e-7);
    assert.ok(s>rankScore('explore',i-1,64,0));
  }
  assert.equal(rankValue('explore',972442),null);
  assert.equal(rankValue('explore',999999),null);
  assert.equal(rankValue('visits',rankScore('visits',20,64,145)),145);
  assert.equal(rankScore('explore',0,64,0),0);
});

test('清除双雪场标记后，旧云快照不会还原标记，历史趟数、里程和本轮新探索均保留',()=>{
  const cloud={pistes:[gold,jade],records:[legacy]};
  const career=mergeSkiProgress(cloud).activity;
  const clear={activity:career,pistes:[],pistesResetAt:100,records:[legacy]};
  for(const merged of [mergeSkiProgress(clear,[cloud]),mergeSkiProgress(cloud,[clear])]){
    assert.deepEqual(merged.pistes,[]);
    assert.equal(merged.records.length,1);
    assert.equal(activityTotals(merged.activity,known).count,2);
    assert.equal(activityTotals(merged.activity,known).metres,2000);
    const a={...clear,pistes:[gold]},b={...clear,pistes:[jade]};
    const restored=mergeSkiProgress(merged,[a,b,cloud]);
    assert.deepEqual(new Set(restored.pistes),known);
    assert.deepEqual(mergeSkiProgress(restored,[cloud,a,b]),restored);
    const second=mergeSkiProgress({...clear,pistesResetAt:110},[restored,cloud]);
    assert.deepEqual(second.pistes,[]);assert.deepEqual(second.activity,career);
  }
});
