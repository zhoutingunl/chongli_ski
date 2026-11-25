import assert from 'node:assert/strict';
import test from 'node:test';
import {createMountainClimate,AUTO_STAGE_SECONDS} from '../src/environment.js';

test('手选时段或天气时，锁定该项，另一个自动选项继续变化',()=>{
  const climate=createMountainClimate(()=>0);
  const clear=climate.sample('day','clear');
  climate.arriveUpperStation('day');
  climate.advance(240,'day','auto',true);
  const storm=climate.sample('day','heavy');
  assert.equal(clear.clock,storm.clock);
  assert.equal(clear.snowAmount,0);
  assert.equal(storm.snowAmount,1);
  assert.ok(storm.density>clear.density&&storm.sunAmount<clear.sunAmount);
  climate.arriveUpperStation('auto');
  assert.equal(climate.sample('auto','light').resolvedTime,'noon');
  climate.advance(120,'auto','light',true);
  assert.equal(climate.sample('auto','light').resolvedTime,'evening');
  assert.equal(climate.sample('auto','light').snowAmount,.38);
});

test('抵达上站推进时段，待在山顶与索道时不增加滑行时间',()=>{
  const climate=createMountainClimate(()=>0);
  assert.equal(climate.sample('auto','clear').resolvedTime,'day');
  for(const stage of ['noon','evening','sunset','twilight','night','aurora','dawn','day']){
    climate.arriveUpperStation('auto');
    climate.advance(AUTO_STAGE_SECONDS*2,'auto','clear',false);
    assert.equal(climate.sample('auto','clear').resolvedTime,stage);
  }
});

test('单次长滑行连续过渡，在两分钟时切换并从新时段继续',()=>{
  const climate=createMountainClimate(()=>0);
  climate.advance(113,'auto','clear',true);
  const before=climate.sample('auto','clear');
  climate.advance(6,'auto','clear',true);
  const blending=climate.sample('auto','clear');
  assert.equal(before.resolvedTime,'day');
  assert.equal(blending.resolvedTime,'day');
  assert.notEqual(before.clock,blending.clock);
  climate.advance(1,'auto','clear',true);
  assert.equal(climate.sample('auto','clear').resolvedTime,'noon');
  climate.arriveUpperStation('auto');
  assert.equal(climate.sample('auto','clear').resolvedTime,'evening');
});

test('自动天气每趟内包含晴、小雪、大雪，并随随机源改变顺序',()=>{
  function watch(seed){
    const climate=createMountainClimate(()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/2**32;});
    const history=new Set(),snapshots=[];
    let previous=climate.sample('day','auto').snowAmount;
    for(let i=0;i<480;i++){
      climate.advance(.25,'day','auto',true);
      const current=climate.sample('day','auto');
      history.add(current.resolvedWeather);
      assert.ok(Math.abs(current.snowAmount-previous)<.10);
      previous=current.snowAmount;
      if(i%10===0)snapshots.push(current.resolvedWeather);
    }
    assert.deepEqual([...history].sort(),['clear','heavy','light']);
    return snapshots;
  }
  assert.notDeepEqual(watch(3),watch(740));
});

test('每个自动时段恰有八十秒晴，其余四十秒为小雪或大雪',()=>{
  const stages=['day','noon','evening','sunset','twilight','night','aurora','dawn'];
  for(let seed of [3,740,1101]){
    const climate=createMountainClimate(()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/2**32;});
    const first=stages.indexOf(climate.sample('auto','clear').resolvedTime);
    for(const stage of [...stages.slice(first),...stages.slice(0,first)]){
      const counts={clear:0,light:0,heavy:0}, sequence=[];
      for(let step=0;step<AUTO_STAGE_SECONDS*2;step++){
        const weather=climate.sample('auto','auto');
        assert.equal(weather.resolvedTime,stage);
        counts[weather.resolvedWeather]++;
        const condition=weather.resolvedWeather==='clear' ? 'clear' : 'snow';
        if(sequence.at(-1)!==condition)sequence.push(condition);
        if(weather.resolvedWeather==='clear')assert.equal(weather.snowAmount,0);
        climate.advance(.5,'auto','auto',true);
      }
      assert.deepEqual(sequence,['clear','snow','clear','snow','clear','snow','clear','snow','clear']);
      assert.equal(counts.clear,160);
      assert.equal(counts.light+counts.heavy,80);
      assert.ok(counts.light>0&&counts.heavy>0);
    }
  }
});

test('手选时段时每两分钟也按八十秒和四十秒分配，停在站台不会消耗当前天气',()=>{
  const climate=createMountainClimate(()=>.57);
  climate.arriveUpperStation('sunset');
  climate.advance(15,'sunset','auto',true);
  const weather=climate.sample('sunset','auto');
  assert.equal(weather.resolvedWeather,'light');
  climate.advance(120,'sunset','auto',false);
  assert.equal(climate.sample('sunset','auto').snowAmount,weather.snowAmount);
  assert.equal(climate.sample('sunset','heavy').snowAmount,1);
  climate.arriveUpperStation('sunset');
  let clear=0;
  for(let i=0;i<120;i++){
    const resolved=climate.sample('sunset','auto');
    assert.equal(resolved.resolvedTime,'sunset');
    clear+=Number(resolved.resolvedWeather==='clear');
    climate.advance(1,'sunset','auto',true);
  }
  assert.equal(clear,80);
});

test('手选正午有独立的天色和更高的太阳，切换到手选后保持十二点',()=>{
  const c=createMountainClimate(()=>0);
  const morning=c.sample('day','clear'), noon=c.sample('noon','clear');
  assert.equal(noon.timeName,'正午');
  assert.equal(noon.clock,'12:00');
  assert.ok(noon.sunDir[1]>morning.sunDir[1]+.08);
  assert.notEqual(noon.sky,morning.sky);
  assert.notEqual(noon.sun,morning.sun);
  c.arriveUpperStation('noon');
  c.advance(300,'noon','clear',true);
  assert.equal(c.sample('noon','clear').clock,'12:00');
});

test('白天到正午、正午到傍晚在上站后也逐渐过渡，停在站台可看到太阳移动',()=>{
  const c=createMountainClimate(()=>0);
  for(const stage of ['noon','evening']){
    const initial=c.sample('auto','clear'),target=c.sample(stage,'clear');
    c.arriveUpperStation('auto');
    const first=c.sample('auto','clear');
    assert.equal(first.resolvedTime,stage);
    assert.equal(first.clock,initial.clock);
    assert.deepEqual(first.sunDir,initial.sunDir);
    c.advance(7,'auto','clear',false);
    const mid=c.sample('auto','clear');
    assert.ok(initial.clock<mid.clock&&mid.clock<target.clock);
    assert.notDeepEqual(mid.sunDir,initial.sunDir);
    c.advance(7,'auto','clear',false);
    assert.equal(c.sample('auto','clear').clock,target.clock);
  }
});

test('八个时段都能作为随机初始时段，环顾和重复采样不重抽',()=>{
  const stages=['day','noon','evening','sunset','twilight','night','aurora','dawn'];
  stages.forEach((stage,i)=>{
    const climate=createMountainClimate(()=>(i+.5)/stages.length);
    assert.equal(climate.sample().resolvedTime,stage);
    climate.advance(180,'auto','auto',false);
    assert.equal(climate.sample().resolvedTime,stage);
    climate.arriveUpperStation('auto');
    assert.equal(climate.sample().resolvedTime,stages[(i+1)%stages.length]);
  });
});

test('从首页再开始一次独立滑行会重新抽时段，手选和上下站仍各自生效',()=>{
  let pick=.10;
  const climate=createMountainClimate(()=>pick);
  pick=.68;climate.startVisit();assert.equal(climate.sample('auto','clear').resolvedTime,'night');
  climate.arriveUpperStation('auto');assert.equal(climate.sample('auto','clear').resolvedTime,'aurora');
  pick=.95;climate.startVisit();assert.equal(climate.sample('auto','clear').resolvedTime,'dawn');
  assert.equal(climate.sample('noon','clear').clock,'12:00');
});

test('每个两分钟周期四阵雪，每阵 8–12 秒，跨周期的晴段也保持短暂',()=>{
  for(let seed=1;seed<=16;seed++){
    let state=seed;
    const climate=createMountainClimate(()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state/2**32;});
    let last,seconds=0;
    for(let i=0;i<480;i++){
      const clear=climate.sample('day','auto').resolvedWeather==='clear';
      if(last!==undefined && last!==clear){
        if(last)assert.ok(seconds<=24);
        else assert.ok(seconds>=8&&seconds<=12);
        seconds=0;
      }
      last=clear;seconds++;climate.advance(1,'day','auto',true);
    }
  }
});

test('粉金霞光只在适合的双自动时段抽取，反复采样稳定，手选和雪幕可独立还原',()=>{
  for(const [index,name] of ['day','noon','evening','sunset','twilight','night','aurora','dawn'].entries()){
    const make=draw=>{let first=true;return createMountainClimate(()=>{if(first){first=false;return (index+.1)/8;}return draw;});};
    const yes=make(.2),no=make(.91),normal=no.sample();
    const glow=yes.sample();
    assert.equal(glow.resolvedTime,name);
    const eligible=['dawn','evening','sunset'].includes(name);
    assert.equal(glow.roseLight,Number(eligible));assert.equal(normal.roseLight,0);
    if(!eligible)continue;
    assert.notEqual(glow.hemi,normal.hemi);assert.notEqual(glow.horizon,normal.horizon);
    assert.notEqual(glow.treeTint,normal.treeTint);assert.deepEqual(glow.sunDir,normal.sunDir);
    assert.equal(yes.sample(name,'auto').roseLight,0);assert.equal(yes.sample('auto','clear').roseLight,0);
    assert.equal(yes.sample().roseLight,1);
    yes.advance(14,'auto','auto',true);assert.ok(yes.sample().roseLight<.12);
    yes.advance(15,'auto','auto',true);assert.equal(yes.sample().roseLight,1);
    yes.arriveUpperStation('auto');assert.equal(yes.sample().roseLight,1);
    yes.advance(7,'auto','auto',false);assert.ok(yes.sample().roseLight>0);
  }
});
