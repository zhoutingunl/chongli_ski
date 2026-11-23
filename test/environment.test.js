import assert from 'node:assert/strict';
import test from 'node:test';
import {createMountainClimate,AUTO_STAGE_SECONDS} from '../src/environment.js';

test('手选时段或天气时，锁定该项，另一个自动选项继续变化',()=>{
  const climate=createMountainClimate(()=>.67);
  const clear=climate.sample('day','clear');
  climate.startRun('day');
  climate.advance(240,'day','auto',true);
  const storm=climate.sample('day','heavy');
  assert.equal(clear.clock,storm.clock);
  assert.equal(clear.snowAmount,0);
  assert.equal(storm.snowAmount,1);
  assert.ok(storm.density>clear.density&&storm.sunAmount<clear.sunAmount);
  climate.startRun('auto');
  climate.advance(120,'auto','light',true);
  assert.equal(climate.sample('auto','light').resolvedTime,'evening');
  assert.equal(climate.sample('auto','light').snowAmount,.38);
});

test('新一趟顺序推进时段，待在山顶与索道时不增加滑行时间',()=>{
  const climate=createMountainClimate();
  for(const stage of ['day','evening','sunset','twilight','night','aurora','dawn','day']){
    climate.startRun('auto');
    climate.advance(AUTO_STAGE_SECONDS*2,'auto','clear',false);
    assert.equal(climate.sample('auto','clear').resolvedTime,stage);
  }
});

test('单次长滑行连续过渡，在两分钟时切换并从新时段继续',()=>{
  const climate=createMountainClimate();
  climate.startRun('auto');
  climate.advance(113,'auto','clear',true);
  const before=climate.sample('auto','clear');
  climate.advance(6,'auto','clear',true);
  const blending=climate.sample('auto','clear');
  assert.equal(before.resolvedTime,'day');
  assert.equal(blending.resolvedTime,'day');
  assert.notEqual(before.clock,blending.clock);
  climate.advance(1,'auto','clear',true);
  assert.equal(climate.sample('auto','clear').resolvedTime,'evening');
  climate.startRun('auto');
  assert.equal(climate.sample('auto','clear').resolvedTime,'sunset');
});

test('自动天气每趟内包含晴、小雪、大雪，并随随机源改变顺序',()=>{
  function watch(seed){
    const climate=createMountainClimate(()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/2**32;});
    const history=new Set(),snapshots=[];
    let previous=climate.sample('day','auto').snowAmount;
    for(let i=0;i<120;i++){
      climate.advance(1,'day','auto',true);
      const current=climate.sample('day','auto');
      history.add(current.resolvedWeather);
      assert.ok(Math.abs(current.snowAmount-previous)<.20);
      previous=current.snowAmount;
      if(i%10===0)snapshots.push(current.resolvedWeather);
    }
    assert.deepEqual([...history].sort(),['clear','heavy','light']);
    return snapshots;
  }
  assert.notDeepEqual(watch(3),watch(740));
});

test('每个自动时段恰有八十秒晴，其余四十秒为小雪或大雪',()=>{
  const stages=['day','evening','sunset','twilight','night','aurora','dawn'];
  for(let seed of [3,740,1101]){
    const climate=createMountainClimate(()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/2**32;});
    climate.startRun('auto');
    for(const stage of stages){
      const counts={clear:0,light:0,heavy:0};
      for(let step=0;step<AUTO_STAGE_SECONDS*2;step++){
        const weather=climate.sample('auto','auto');
        assert.equal(weather.resolvedTime,stage);
        counts[weather.resolvedWeather]++;
        if(weather.resolvedWeather==='clear')assert.equal(weather.snowAmount,0);
        climate.advance(.5,'auto','auto',true);
      }
      assert.equal(counts.clear,160);
      assert.equal(counts.light+counts.heavy,80);
      assert.ok(counts.light>0&&counts.heavy>0);
    }
  }
});

test('手选时段时每两分钟也按八十秒和四十秒分配，停在站台不会消耗当前天气',()=>{
  const climate=createMountainClimate(()=>.57);
  climate.startRun('sunset');
  climate.advance(45,'sunset','auto',true);
  const weather=climate.sample('sunset','auto');
  assert.equal(weather.resolvedWeather,'light');
  climate.advance(120,'sunset','auto',false);
  assert.equal(climate.sample('sunset','auto').snowAmount,weather.snowAmount);
  assert.equal(climate.sample('sunset','heavy').snowAmount,1);
  climate.startRun('sunset');
  let clear=0;
  for(let i=0;i<120;i++){
    const resolved=climate.sample('sunset','auto');
    assert.equal(resolved.resolvedTime,'sunset');
    clear+=Number(resolved.resolvedWeather==='clear');
    climate.advance(1,'sunset','auto',true);
  }
  assert.equal(clear,80);
});
