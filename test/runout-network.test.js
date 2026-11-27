import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {prepareMountain} from '../src/mountain.js';
import {createSkiNavigation} from '../src/navigation.js';
import {arrivalLift,nearbyLiftStation} from '../src/lift-access.js';
import {Descent} from '../src/simulation.js';

const data=prepareMountain(JSON.parse(readFileSync(new URL('../public/assets/geo/mountain.json',import.meta.url))));
const nav=createSkiNavigation(data);
const distance=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1]);
const position=s=>[s.x,s.z];
const routeNamed=name=>data.pisteRoutes.find(r=>r.name===name);
const atEnd=r=>({route:r,mode:'finished',x:r.points.at(-1)[0],z:r.points.at(-1)[1]});

function arrive(route,gear='ski',assist=true){
  const sim=new Descent(data,{gear,assist,variedMoves:false});
  sim.start(nav.safeRun(route));
  const along=sim.route.length-(assist?.12:17),f=sim.route.frame(along),y=data.height(f.x,f.z);
  Object.assign(sim,{along,x:f.x,z:f.z,y,ground:y,speed:0,travel:600,elapsed:60,heading:f.angle,travelHeading:f.angle});
  sim.tick(1/30);
  assert.equal(sim.mode,'finished',route.name);
  return sim;
}

function skiToNextStop(sim){
  const start=sim.elapsed;
  while(sim.mode==='run'&&sim.elapsed-start<310)sim.tick(.25);
  assert.equal(sim.mode,'finished',sim.route.name);
}

test('两山的每条目录路线、联滑行程和每座上站的实际出口都有可走的终点，向导链不返回已到过的终点',()=>{
  const routes=[...data.allRoutes];
  assert.equal(data.trailCatalog.length,64);
  assert.equal(data.venues.length,7);
  const used=new Set();
  for(const lift of data.lifts){
    const place=nav.upperStation(lift);
    assert.ok(place?.guide.options.length,lift.name);
    routes.push(...place.guide.options.map(o=>o.plan));
  }
  const inspected=new Map();
  function visit(route,seen){
    const marker=route.points.at(-1).map(Math.round).join(',');
    assert.ok(!seen.has(marker),'续滑回到原终点 '+route.name+' '+marker);
    const here=atEnd(route),main=nav.valleyLine(here);
    const exits=main?.finishKind==='lift-link'?[main,nav.valleyLine(here,true)]:[main];
    const targets=exits.filter(Boolean).map(next=>next.points.at(-1));
    if(inspected.has(marker)){
      assert.deepEqual(targets,inspected.get(marker),route.name+' 共用雪面应有相同出口');
      return;
    }
    if(!main){
      assert.ok(nearbyLiftStation(data,here)?.lift,route.name);
      const sim=arrive(route),foot=position(sim);
      assert.ok(sim.continueAtBase(null,sim.heading));assert.ok(sim.freeSnowfront);
      assert.deepEqual(position(sim),foot);sim.tick(.6,{boost:true});
      assert.equal(sim.mode,'run');assert.ok(distance(position(sim),foot)>.5,route.name);
    }
    for(const next of exits.filter(Boolean)){
      assert.deepEqual(next.points[0],position(here));
      assert.equal(next.destination,route.destination);
      assert.ok(next.length>30,route.name);
      assert.ok(distance(next.points.at(-1),position(here))>30,next.name);
      const end=Math.min(next.approach.endDistance,next.length);
      for(let d=0;d<=end;d+=2){
        const f=next.glideFrame(d);
        assert.equal(data.obstacles.contact(f.x,f.z,.45),null,route.name+' → '+next.name+' '+d+'m');
      }
      visit(next,new Set([...seen,marker]));
    }
    inspected.set(marker,targets);
  }
  for(const route of routes){
    for(const leg of route.legs)used.add(leg.trailId);
    visit(nav.safeRun(route),new Set());
  }
  assert.deepEqual(data.trails.filter(t=>!used.has(t.id)).map(t=>t.name),[]);
  assert.ok(inspected.size>=12,'含一索连接段的终点');
});

for(const name of ['雪上技巧','空中技巧']){
  test(name+'减速区可以停留，再滑入芍药花、雪绒花和锦带花并抵达三索',()=>{
    const sim=arrive(routeNamed(name));
    const foot=position(sim),{travel,elapsed,splits,pisteVisits,startY}=sim;
    sim.tick(8,{boost:true});assert.deepEqual([sim.elapsed,sim.travel],[elapsed,travel]);
    const line=nav.valleyLine(sim);
    assert.equal(line.approach.target,'芍药花');
    assert.ok(sim.continueAtBase(line));assert.deepEqual(position(sim),foot);
    assert.deepEqual([sim.elapsed,sim.travel,sim.startY],[elapsed,travel,startY]);
    skiToNextStop(sim);
    assert.equal(nearbyLiftStation(data,sim).lift.name,'3索');
    assert.deepEqual(sim.splits.completed.map(s=>s.name),['芍药花','雪绒花','锦带花']);
    assert.equal(sim.splits,splits);assert.equal(sim.pisteVisits,pisteVisits);
    assert.ok(sim.travel-travel>1500);assert.equal(sim.continuedFrom.name,name);
  });
}

test('太浩岩壁与向日葵雪面可选一索或风铃草；选择哪个都从双脚处起滑',()=>{
  for(const name of ['水杨梅','向日葵','太浩岩壁']){
    for(const piste of [false,true]){
      const sim=arrive(routeNamed(name),'board'),foot=position(sim);
      const next=nav.valleyLine(sim,piste);
      assert.equal(next.approach.target,piste?'风铃草':'一索下站');
      assert.ok(sim.continueAtBase(next));assert.deepEqual(position(sim),foot);
      skiToNextStop(sim);
      assert.equal(nearbyLiftStation(data,sim).lift.name,piste?'22索':'1索');
    }
  }
});

test('22索两侧的收板区可沿当前朝向自由滑行，恢复方向和刹车，旧终点不重复结算',()=>{
  for(const [name,gear] of [['风铃草','ski'],['蓝刺头','board']])for(const assist of [false,true]){
    const sim=arrive(routeNamed(name),gear,assist);
    assert.equal(nearbyLiftStation(data,sim).lift.name,'22索');
    assert.equal(nav.valleyLine(sim),null);
    const foot=position(sim),{travel,elapsed,splits}=sim,heading=sim.heading+.24;
    assert.ok(sim.continueAtBase(null,heading));
    assert.deepEqual([sim.x,sim.z,sim.travel,sim.elapsed,sim.travelHeading],[...foot,travel,elapsed,heading]);
    sim.tick(2,{boost:true});assert.equal(sim.mode,'run');
    assert.ok(sim.freeSnowfront);assert.ok(distance(foot,position(sim))>2);
    sim.tick(5,{boost:true,steer:.35});sim.tick(3,{brake:true});
    assert.equal(sim.mode,'run');assert.equal(sim.splits,splits);
    assert.ok(sim.travel>travel+7&&sim.elapsed>elapsed+9);
    assert.equal(sim.continueAtBase(),false);
    sim.start(routeNamed('雪绒花'));assert.equal(sim.freeSnowfront,false);
  }
});

test('22索上站向前默认可出本区域到达一索，原来的太子城回环仍可手选',()=>{
  const chair=data.lifts.find(l=>l.name==='22索'),upper=nav.upperStation(chair);
  const options=upper.guide.options;
  assert.ok(options.some(o=>arrivalLift(data,o.plan).id===chair.id));
  const forward=nav.departure(chair.resort,...upper.position,upper.heading,null,upper.guide);
  const transfer=nav.valleyLine(atEnd(forward));
  assert.equal(transfer?.finishKind,'lift-link');
  const lift=arrivalLift(data,transfer);
  assert.equal(lift.name,'1索');assert.ok(nav.isSummitStation(lift));
});

test('从每座卫星索道都有经由雪道和换乘返回主山顶的路径',()=>{
  function stationsFrom(line,found,visited){
    const route=nav.safeRun(line),here=atEnd(route),key=route.points.at(-1).join(',');
    if(visited.has(key))return;
    visited.add(key);found.add(nearbyLiftStation(data,here).lift);
    const next=nav.valleyLine(here);
    if(!next)return;
    stationsFrom(next,found,visited);
    const alternate=next.finishKind==='lift-link'&&nav.valleyLine(here,true);
    if(alternate)stationsFrom(alternate,found,visited);
  }
  for(const start of data.lifts){
    const reachable=new Set([start]);
    for(const lift of reachable){
      if(nav.isSummitStation(lift))break;
      const visited=new Set();
      for(const exit of nav.upperStation(lift).guide.options)stationsFrom(exit.plan,reachable,visited);
    }
    assert.ok([...reachable].some(l=>nav.isSummitStation(l)),start.name+' 困在同一索道');
  }
});

test('训练道口按住加速可直接续滑；远离终点和跳跃中不触发换线',()=>{
  const r=nav.safeRun(routeNamed('雪上技巧')),sim=new Descent(data,{gear:'ski',assist:true});
  sim.start(r);assert.equal(sim.continueAtBase(),false);
  const along=r.length-20,f=r.frame(along);
  Object.assign(sim,{along,x:f.x,z:f.z,ground:data.height(f.x,f.z),heading:f.angle,travelHeading:f.angle,
    speed:9,travel:650,elapsed:50,airborne:true});
  assert.equal(sim.continueAtBase(),false);sim.airborne=false;sim.y=sim.ground;
  sim.tick(1/30,{boost:true});
  assert.equal(sim.route.approach.target,'芍药花');assert.equal(sim.mode,'run');
  assert.ok(sim.travel>650&&sim.travel<651);
});

test('山脚自由滑行只在重新进入有足够下滑距离的雪道时恢复循线',()=>{
  const sim=arrive(routeNamed('风铃草'));assert.ok(sim.continueAtBase());
  assert.equal(nav.alignTravel(sim),null);
  const next=nav.safeRun(routeNamed('太浩岩壁')),f=next.frame(260);
  Object.assign(sim,{x:f.x,z:f.z,ground:data.height(f.x,f.z),y:data.height(f.x,f.z),
    speed:8,heading:f.angle,travelHeading:f.angle,neutralTime:1,courseCheck:0});
  sim.tick(1/30);assert.equal(sim.mode,'run');assert.equal(sim.freeSnowfront,false);
  assert.ok(sim.guided&&sim.route.length-sim.along>90);
});
