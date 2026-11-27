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

test('道外低速持续两秒才提示，恢复落在最近雪道且不增加已滑距离',()=>{
  const sim=skierAt(-350,-420);
  assert.equal(sim.onTrail,false);
  for(let step=0;step<179;step++){
    sim.speed=1.2;
    sim.tick(1/90);
  }
  assert.equal(sim.recoveryReady,false);
  sim.tick(1/90);
  assert.equal(sim.recoveryReady,true);
  const {travel,elapsed,pisteVisits}=sim;
  assert.equal(sim.recoverToPiste(),true);
  assert.equal(sim.mode,'run');
  assert.equal(sim.onTrail,true);
  assert.equal(data.obstacles.contact(sim.x,sim.z,2.2),null);
  assert.equal(sim.recoveryReady,false);
  assert.deepEqual([sim.travel,sim.elapsed,sim.pisteVisits],[travel,elapsed,pisteVisits]);
});

test('道外提示在操作或加速后收起，释放并再次连续低于十五公里时速才出现',()=>{
  const sim=skierAt(-350,-420);
  const coast=(n,speed,input={})=>{for(let i=0;i<n;i++){sim.speed=speed;sim.tick(1/90,input);}};
  for(const control of [{boost:true},{brake:true},{steer:.7},{trim:-.8}]){
    coast(180,3.5);assert.equal(sim.recoveryReady,true);
    coast(181,1,control);assert.equal(sim.recoveryReady,false);
    coast(179,3.5);assert.equal(sim.recoveryReady,false);
    coast(1,3.5);assert.equal(sim.recoveryReady,true);
    coast(1,4.4);assert.equal(sim.recoveryReady,false);
  }
  coast(180,1);sim.beginJump();assert.equal(sim.recoveryReady,false);sim.cancelJump();
  const trail=data.trails.find(t=>t.name==='金龙道');
  [sim.x,sim.z]=trail.points[2];sim.y=sim.ground=data.height(sim.x,sim.z);
  coast(1,1);assert.equal(sim.onTrail,true);assert.equal(sim.recoveryReady,false);
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

test('玉龙道左转可连续滑入娇龙道，山脚停留后也能从原地再出发并经过其他索道',()=>{
  const jade=data.routes.find(route=>route.id==='wanlong-classic');
  for(const stop of [false,true]){
    const sim=new Descent(data,{gear:'ski',assist:true});sim.start(jade);
    const along=jade.length-(stop?.12:25),f=jade.frame(along),visits=sim.pisteVisits;
    const y=data.height(f.x,f.z);
    Object.assign(sim,{along,x:f.x,z:f.z,y,ground:y,heading:f.angle,travelHeading:f.angle,
      travel:2200,elapsed:120,maxSpeed:22,speed:stop?0:12});
    sim.tick(1/60,stop?{}:{steer:-.5});
    if(stop){
      assert.equal(sim.mode,'finished');
      assert.equal(nearbyLiftStation(data,sim).end,'bottom');
      const before=[sim.x,sim.z,sim.elapsed,sim.travel];
      sim.tick(15);
      assert.ok(sim.continueAtBase());assert.deepEqual([sim.x,sim.z,sim.elapsed,sim.travel],before);
    }
    assert.equal(sim.route.name,'娇龙道');assert.equal(sim.mode,'run');
    assert.equal(sim.pisteVisits,visits);assert.equal(sim.continuedFrom.id,jade.id);
    assert.equal(sim.continueAtBase(),false);
    const stations=new Set();
    for(let i=0;i<180*60&&sim.mode==='run';i++){
      sim.tick(1/60,{boost:true,steer:!stop&&i<17?-.5:0});
      const n=nearbyLiftStation(data,sim);
      if(n?.end==='bottom')stations.add(n.lift.name);
    }
    assert.ok(stations.has('三索'));assert.ok(stations.has('七索（新）'));
    assert.equal(sim.mode,'finished');assert.ok(sim.travel>3000&&sim.elapsed>170);
    assert.equal(sim.continueAtBase(),false);
  }
});

test('云顶三索与大厅雪面可以连续接一索，上车前可停留，连接段保持同一趟',()=>{
  for(const id of ['genting-classic','genting-valley'])for(const stop of [false,true]){
    const sim=new Descent(data,{gear:'ski',assist:true});
    const r=sim.navigation.safeRun(data.routes.find(route=>route.id===id));sim.start(r);
    const along=r.length-(stop?.1:22),f=r.frame(along),ground=data.height(f.x,f.z);
    Object.assign(sim,{along,x:f.x,z:f.z,ground,y:ground,heading:f.angle,travelHeading:f.angle,speed:stop?0:8,travel:2400,elapsed:175});
    const splits=sim.splits;
    sim.tick(.03,{boost:!stop});
    if(stop){
      assert.equal(sim.mode,'finished');assert.equal(nearbyLiftStation(data,sim).lift.name,'3索');
      const stoppedDistance=sim.travel;
      sim.tick(10);assert.ok(sim.continueAtBase());assert.equal(sim.travel,stoppedDistance);
    }
    assert.equal(sim.route.finishKind,'lift-link');assert.equal(sim.splits,splits);
    let k=0;
    while(sim.mode==='run'&&k++<200*30){
      sim.tick(1/30,{boost:true});
      assert.equal(data.obstacles.contact(sim.x,sim.z),null);
    }
    assert.equal(sim.mode,'finished');assert.ok(sim.travel>2460);
    const gondola=nearbyLiftStation(data,sim);
    assert.equal(gondola.lift.name,'1索');assert.ok(sim.navigation.isSummitStation(gondola.lift));
    assert.equal(sim.continueAtBase(),false);
  }
});
