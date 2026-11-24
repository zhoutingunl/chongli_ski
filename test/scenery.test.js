import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createMountainClimate} from '../src/environment.js';
import {prepareMountain} from '../src/mountain.js';
import {Descent} from '../src/simulation.js';
import {scenery,stops,cloudFloor,cloudRoof,trialRouteId,trialClimate,blendScenery,SceneryTrial} from '../src/scenery.js';
import {sceneryUniforms,applySceneryUniforms} from '../src/scenic-materials.js';

const source=new URL('../public/assets/geo/mountain.json',import.meta.url);
const mountain=prepareMountain(JSON.parse(readFileSync(source,'utf8')));
const route=mountain.routes.find(r=>r.id===trialRouteId);
const automatic=Object.freeze({time:'auto',weather:'auto'});

test('同趟巡览按实际里程访问九种自然景观、六种画境各一次',()=>{
  const trial=new SceneryTrial();trial.enter(route,true);
  assert.equal(scenery.filter(s=>s.group==='nature').length,9);
  assert.equal(scenery.filter(s=>s.group==='art').length,6);
  const seen=[trial.id];
  for(let m=1;m<=route.length;m++)if(trial.advance(m))seen.push(trial.id);
  assert.deepEqual(seen,stops.map(s=>s[1]));
  assert.deepEqual(seen.slice().sort(),scenery.map(s=>s.id).sort());
  assert.equal(trial.route,route);
  assert.equal(trial.example,true);
  assert.equal(trial.advance(-70),false);
  assert.equal(trial.id,seen.at(-1));
});

test('玉龙道巡览的云海段从云顶上方滑到云底下方',()=>{
  const i=stops.findIndex(s=>s[1]==='cloudsea');
  const altitude=f=>{const {x,z}=route.at(route.length*f);return mountain.height(x,z);};
  assert.ok(altitude(stops[i][0])>cloudRoof);
  assert.ok(altitude(stops[i+1][0])<cloudFloor);
  assert.ok(Math.abs(altitude(.63)-(cloudFloor+cloudRoof)/2)<8);
});

test('中途定格选景与来回对照保留路线和进度，再开巡览从脚下接续',()=>{
  const trial=new SceneryTrial();trial.enter(route,false,route.length*.49);
  trial.select('ink');trial.original=true;
  const previous=trial.id;trial.select('unknown');assert.equal(trial.id,previous);
  trial.step(1);assert.equal(trial.original,false);assert.equal(trial.touring,false);
  trial.advance(route.length*.64);assert.equal(trial.fraction,.64);
  trial.touring=true;trial.advance(route.length*.61);
  assert.equal(trial.id,'cloudsea');assert.equal(trial.route,route);
  trial.close();assert.equal(trial.route,null);assert.equal(trial.frozen,false);
  trial.enter(route,true,0);assert.equal(trial.id,'gold');
});

test('原景和画境使用同一时段天气，手动偏好按项保留，能临时看示例再退出',()=>{
  const trial=new SceneryTrial(),climate=createMountainClimate(()=>.26);
  const pref=Object.freeze({time:'noon',weather:'auto'});
  const before=climate.sample(pref.time,pref.weather);
  trial.enter(route,true);trial.select('galaxy');assert.equal(trialClimate(trial,pref,climate).resolvedTime,'night');
  trial.enter(route);trial.select('starry');
  assert.equal(trialClimate(trial,pref,climate).resolvedTime,'noon');
  trial.example=true;
  const themed=trialClimate(trial,pref,climate);
  trial.original=true;
  const plain=trialClimate(trial,pref,climate);
  assert.equal(themed.resolvedTime,'night');
  assert.deepEqual([themed.clock,themed.resolvedWeather,themed.elapsed],[plain.clock,plain.resolvedWeather,plain.elapsed]);
  assert.equal(plain.sceneId,undefined);
  trial.close();assert.deepEqual(trialClimate(trial,pref,climate),before);
  trial.enter(route);trial.select('squall');
  const locked=trialClimate(trial,{time:'auto',weather:'clear'},climate);
  assert.equal(locked.snowAmount,0);assert.equal(locked.sceneStrength,0);
});

test('自动换景的光色和雪量连续，定格端点可精确还原',()=>{
  const trial=new SceneryTrial(),climate=createMountainClimate(()=>.11);
  trial.enter(route);trial.select('squall');const snow=trialClimate(trial,automatic,climate);
  trial.select('moon');const night=trialClimate(trial,automatic,climate);
  assert.equal(blendScenery(snow,night,0),snow);assert.equal(blendScenery(snow,night,1),night);
  const middle=blendScenery(snow,night,.5);
  assert.ok(middle.snowAmount>0&&middle.snowAmount<snow.snowAmount);
  assert.equal(middle.sceneStrength,0);assert.equal(middle.resolvedWeather,'light');
  for(const key of ['dir','sunDir','moonDir'])assert.ok(Math.abs(Math.hypot(...middle[key])-1)<1e-9);
});

test('缓存的基础天气和不同三维场景的材质参数彼此独立',()=>{
  const climate=createMountainClimate(()=>.22),trial=new SceneryTrial();trial.enter(route);
  const original=structuredClone(climate.sample('day','clear'));
  const a=sceneryUniforms(),b=sceneryUniforms(),codes=new Set();
  for(const preset of scenery){
    trial.select(preset.id);
    const e=trialClimate(trial,automatic,climate);
    applySceneryUniforms(a,e);codes.add(a.ridgeScene.value);
    assert.equal(b.ridgeScene.value,0);assert.ok(Number.isFinite(e.density));
  }
  assert.equal(codes.size,scenery.length);assert.ok(!codes.has(0));
  assert.deepEqual(climate.sample('day','clear'),original);
  trial.close();applySceneryUniforms(a,trialClimate(trial,automatic,climate));assert.equal(a.ridgeScene.value,0);
});

test('同一趟的自动换景和原版得到同一份滑行轨迹、计时与道段',()=>{
  const trial=new SceneryTrial(),climate=createMountainClimate(()=>.17);
  const base=new Descent(mountain,{gear:'ski',assist:true}),comparison=new Descent(mountain,{gear:'ski',assist:true});
  base.start(route);comparison.start(route);trial.enter(route,true);
  const dt=1/60;
  const seen=new Set();
  for(let i=0;i<60*330&&base.mode==='run';i++){
    base.tick(dt,{});comparison.tick(dt,{});
    if(i%12)continue;
    trial.advance(comparison.along);seen.add(trial.id);
    climate.advance(dt*12,'auto','auto',true);trialClimate(trial,automatic,climate);
    assert.deepEqual([base.x,base.z,base.speed,base.along,base.elapsed],[comparison.x,comparison.z,comparison.speed,comparison.along,comparison.elapsed]);
  }
  assert.equal(base.mode,'finished');assert.equal(seen.size,scenery.length);
  assert.deepEqual(comparison.pisteVisits,base.pisteVisits);assert.equal(base.travel,comparison.travel);
});
