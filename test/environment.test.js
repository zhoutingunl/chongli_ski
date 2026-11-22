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
