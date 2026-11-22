import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {prepareMountain} from '../src/mountain.js';
import {Descent} from '../src/simulation.js';
import {createPisteProgress} from '../src/piste-progress.js';
import {placePisteLights,LIGHT_EDGE_CLEARANCE} from '../src/piste-lighting.js';

const data=prepareMountain(JSON.parse(readFileSync(new URL('../public/assets/geo/mountain.json',import.meta.url),'utf8')));

test('滑上金龙会自动标记并可恢复记录，进入地图和起点时不会提前标记玉龙',()=>{
  const progress=createPisteProgress(data,[]);
  const sim=new Descent(data,{gear:'ski',assist:true});
  const route=data.routes.find(r=>r.id==='wanlong-gold');
  const gold=data.allRoutes.find(r=>r.id==='wanlong-piste-7');
  const jade=data.allRoutes.find(r=>r.id==='wanlong-piste-6');
  sim.start(route);
  assert.equal(progress.observe(sim.pisteVisits),false);
  assert.equal(progress.visited(gold),false);
  for(let i=0;i<1800&&!progress.visited(gold);i++){
    sim.tick(1/90,{boost:true});progress.observe(sim.pisteVisits);
  }
  assert.equal(progress.visited(gold),true);
  assert.equal(progress.visited(jade),false);
  assert.equal(progress.visited(route),false);
  const restored=createPisteProgress(data,[...progress.completed]);
  assert.equal(restored.visited(gold),true);
  assert.equal(restored.totals('wanlong').ridden,1);
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
