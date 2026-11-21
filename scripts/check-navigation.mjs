// Replay the controls that used to lock the first summit choice.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {prepareMountain} from '../src/mountain.js';
import {createSkiNavigation} from '../src/navigation.js';
import {Descent} from '../src/simulation.js';

const data=prepareMountain(JSON.parse(readFileSync(new URL('../public/assets/geo/mountain.json',import.meta.url))));
const nav=createSkiNavigation(data), summit=data.summitPlaces.wanlong;
const course=id=>data.allRoutes.find(r=>r.id===id);
const west='wanlong-gold', east='wanlong-long';

function advance(sim,seconds,input={}){
  for(let i=0;i<Math.round(seconds*60);i++){
    const {x,z,speed}=sim;
    sim.tick(1/60,input);
    assert.ok(Math.hypot(sim.x-x,sim.z-z)<(Math.max(speed,sim.speed)+1)/60+.15,'A course change moved the boots discontinuously');
  }
}
function standOn(route,along,speed=0){
  const sim=new Descent(data,{assist:true,gear:'ski'});
  sim.start(route);
  const f=route.frame(along);
  Object.assign(sim,{along,x:f.x,z:f.z,heading:f.angle,travelHeading:f.angle,planIndex:f.index,speed});
  sim.y=sim.ground=data.height(f.x,f.z);
  sim.surface();
  return sim;
}
function pushOff(heading,gear){
  const sim=new Descent(data,{assist:true,gear});
  sim.start(nav.departure('wanlong',...summit.position,heading));
  sim.speed=2.15;sim.freeHeading(heading);
  return sim;
}
function signs(sim){
  const options=nav.nearbyChoices(sim)?.options||[];
  assert.ok(options.every(o=>o.name&&o.selectable&&Number.isFinite(o.heading)));
  assert.equal(new Set(options.map(o=>o.name)).size,options.length);
  return options.map(o=>o.name);
}

assert.deepEqual(signs({mode:'summit',x:summit.position[0],z:summit.position[1],route:course(east)}).sort(),
  ['金龙道','长龙道','银龙道','海龙道'].sort());
for(const gear of ['ski','board']){
  for(const [heading,from,to,turn] of [[summit.heading,east,west,-.68],[summit.heading-.70,west,east,.68]]){
    for(const delay of [5,11]){
      const sim=pushOff(heading,gear);
      advance(sim,delay,{boost:true});
      assert.equal(sim.route.id,from);
      advance(sim,.82,{steer:turn,boost:true});
      advance(sim,4,{boost:true});
      assert.equal(sim.route.id,to);
      assert.ok(sim.elapsed>delay && sim.travel>8);
    }
  }
}
const changeTwice=pushOff(summit.heading,'ski');
advance(changeTwice,5,{boost:true});
advance(changeTwice,.65,{steer:-.68,boost:true});advance(changeTwice,3,{boost:true});
assert.equal(changeTwice.route.id,west);
advance(changeTwice,.82,{steer:.68,boost:true});advance(changeTwice,4,{boost:true});
assert.equal(changeTwice.route.id,east);

const long=course(east),marks=nav.stationsOn(long);
const first=marks.find(m=>m.namedExits.some(o=>o.name.includes('蹬坡')));
const jade=marks.find(m=>m.namedExits.some(o=>o.name==='玉龙道'));
assert.ok(first.along<jade.along);
assert.ok(signs(standOn(long,first.along-25,12)).some(n=>n.includes('至云顶')));
assert.ok(!signs(standOn(long,first.along-25,12)).includes('玉龙道'));
assert.ok(signs(standOn(long,jade.along-25,12)).includes('玉龙道'));

const climb=nav.canonical('wanlong-aster-climb');
const coast=standOn(climb,46,4),push=standOn(climb,46,4);
advance(coast,15);advance(push,15,{boost:true});
assert.equal(coast.speed,0);
assert.ok(push.ground-coast.ground>1 && push.speed>.4 && push.speed<2.5);
const pivot=standOn(long,150,0),before=pivot.travelHeading;
advance(pivot,2,{steer:.68,brake:true});
assert.ok(Math.abs(pivot.travelHeading-before)>.65);

for(const region of ['wanlong','genting']){
  const rows=data.trailCatalog.filter(t=>t.resort===region);
  assert.equal(rows.length,32);
  for(const row of rows){
    const run=course(row.routeId);
    assert.ok(run&&run.pisteDistance>0&&run.primaryEndIndex>run.primaryStartIndex);
    assert.ok(run.finishKind==='base'&&run.finishLiftId);
  }
}
console.log('Passed: both summit transfers on skis and snowboard, repeated course change, downhill junction order, uphill effort, standing pivot, and 64 public pistes.');
