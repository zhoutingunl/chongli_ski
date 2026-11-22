import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {prepareMountain} from '../src/mountain.js';
import {Descent} from '../src/simulation.js';
import {nearbyLiftStation} from '../src/lift-access.js';
import {placeLiftSupports} from '../src/lift-supports.js';

const raw=JSON.parse(readFileSync(new URL('../public/assets/geo/mountain.json',import.meta.url),'utf8'));
const data=prepareMountain(raw);
const longDragon=data.allRoutes.find(route=>route.id==='wanlong-piste-1');

function skierAt(x,z,dataSource=data){
  const sim=new Descent(dataSource,{gear:'ski',assist:false});
  sim.start(longDragon);
  sim.x=x;sim.z=z;sim.y=sim.ground=dataSource.height(x,z);
  sim.travel=1200;sim.elapsed=75;
  sim.surface();
  return sim;
}

test('长龙道滑手停在山脚大厅边仍可乘一索，并在安全雪面停驻',()=>{
  const sim=skierAt(-821,-1523);
  assert.ok(Math.hypot(sim.x+745.3,sim.z+1532.4)>48);
  assert.equal(nearbyLiftStation(data,sim)?.lift.id,'w1368988315');
  sim.tick(1.3,{brake:true});
  assert.equal(sim.mode,'finished');
  assert.equal(nearbyLiftStation(data,sim)?.end,'bottom');
  assert.equal(data.obstacles.contact(sim.x,sim.z),null);
  assert.equal(nearbyLiftStation(data,skierAt(-748,-1390))?.lift.id,undefined);
});

test('道外停车满五秒才提示，恢复落在雪道且不增加已滑距离',()=>{
  const sim=skierAt(-350,-420);
  assert.equal(sim.onTrail,false);
  sim.tick(4.85,{brake:true});
  assert.equal(sim.recoveryReady,false);
  sim.tick(.20,{brake:true});
  assert.equal(sim.recoveryReady,true);
  const {travel,elapsed,pisteVisits}=sim;
  assert.equal(sim.recoverToPiste(),true);
  assert.equal(sim.mode,'run');
  assert.equal(sim.onTrail,true);
  assert.equal(data.obstacles.contact(sim.x,sim.z,2.2),null);
  assert.equal(sim.recoveryReady,false);
  assert.deepEqual([sim.travel,sim.elapsed,sim.pisteVisits],[travel,elapsed,pisteVisits]);
});

test('短时间内连续撞树后停下，即使靠着道边也可提前返回',()=>{
  const near=data.trails.find(t=>t.name==='金龙道').points[2];
  const sim=skierAt(...near);
  sim.data={...data,obstacles:{contact:(x,z)=>({x,z,nx:0,nz:0,kind:'tree'})}};
  sim.speed=.4;
  sim.tick(.21,{brake:true});
  assert.equal(sim.recoveryReady,false);
  sim.tick(.08,{brake:true});
  assert.ok(sim.treeHits>=2);
  assert.equal(sim.recoveryReady,true);
});

test('沿线支柱避开所有雪道净空，索道上下站保持原坐标',()=>{
  let supports=0;
  for(const lift of data.lifts){
    const points=placeLiftSupports(lift.points,data);
    assert.deepEqual(points[0],lift.points[0]);
    assert.deepEqual(points.at(-1),lift.points.at(-1));
    for(const [x,z] of points.slice(1,-1)){
      supports++;
      assert.equal(data.obstacles.contact(x,z,4.5),null);
      assert.ok([...data.index.corridors(x,z,32)].every(hit=>hit.distance>=(hit.trail.width||38)*.5+4.5));
    }
  }
  assert.ok(supports>90);
});
