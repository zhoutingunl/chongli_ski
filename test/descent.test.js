import assert from 'node:assert/strict';
import test from 'node:test';
import {prepareMountain} from '../src/mountain.js';
import {Descent} from '../src/simulation.js';
import {AutomaticTurns} from '../src/automatic-turns.js';

// A single planar piste isolates the snow physics from the surveyed junctions.
function startRun({grade = 0, length = 900, lateral = 0, assist = false, gear = 'ski'} = {}) {
  const bounds = {minX: -100, maxX: 100, minZ: -1000, maxZ: 100};
  const height = z => 1500 + grade * z;
  const mountain = prepareMountain({
    bounds,
    dem: {cols: 2, rows: 2, heights: [height(bounds.minZ), height(bounds.minZ), height(bounds.maxZ), height(bounds.maxZ)]},
    trails: [{id: 'piste', width: 40, points: [[0, 0], [0, -length]]}],
    buildings: [],
    routes: [{id: 'practice', points: [[lateral, 0], [lateral, -length]]}]
  });
  const run = new Descent(mountain, {assist, gear});
  run.start(mountain.routes[0]);
  return run;
}

function jumpPeak(run, chargeSeconds) {
  assert.ok(run.beginJump());
  assert.equal(run.beginJump(), false);
  run.tick(chargeSeconds);
  assert.ok(run.releaseJump());
  assert.equal(run.releaseJump(), false);
  assert.equal(run.beginJump(), false);
  let peak = 0;
  for (let frame = 0; frame < 180 && run.airborne; frame++) {
    run.tick(1 / 90);
    peak = Math.max(peak, run.airHeight);
    if (run.airborne) assert.equal(run.spray, 0);
  }
  assert.equal(run.airborne, false);
  assert.equal(run.y, run.ground);
  assert.equal(run.beginJump(), false, 'Landing cooldown prevents an immediate second jump');
  return peak;
}

for (const [gear, label] of [['ski', '双板'], ['board', '单板']]) {
  test(label + '蓄力越久跳得越高，只能落地并恢复后再起跳', () => {
    const run = startRun({gear});
    const tap = jumpPeak(run, 0.03);
    run.tick(0.4);
    const hold = jumpPeak(run, 0.9);
    assert.ok(tap > 0 && hold > tap + 0.5);
  });
}

test('同一坡面上刹车比自然下滑更快减速，持续刹车能停住', () => {
  const glide = startRun({grade: 0.25});
  const brake = startRun({grade: 0.25});
  glide.tick(5);
  brake.tick(5);
  assert.ok(glide.speed > 5);
  assert.equal(brake.speed, glide.speed);
  glide.tick(2);
  brake.tick(2, {brake: true});
  assert.ok(glide.speed > 5 && glide.travel > brake.travel);
  assert.equal(brake.speed, 0);
});

test('同样的站姿在道边软雪留下更深的压痕', () => {
  const centre = startRun();
  const verge = startRun({lateral: 26});
  centre.tick(2);
  verge.tick(2);
  assert.ok(verge.snowSoftness > centre.snowSoftness);
  assert.ok(centre.snowSink > 0 && verge.snowSink > 2 * centre.snowSink);
});

test('滑到山脚后计时和位移停止，重滑从原道口开始', () => {
  const run = startRun({grade: 0.20, length: 85, assist: true});
  const route = run.route;
  for (let seconds = 0; seconds < 90 && run.mode === 'run'; seconds++) run.tick(1);
  assert.equal(run.mode, 'finished');
  assert.ok(route.length - run.along < 1);
  assert.equal(run.speed, 0);
  const atBase = [run.x, run.y, run.z, run.elapsed, run.travel];
  run.tick(2, {boost: true, steer: 1});
  assert.deepEqual([run.x, run.y, run.z, run.elapsed, run.travel], atBase);
  assert.equal(run.beginJump(), false);
  run.start(route);
  assert.equal(run.mode, 'run');
  assert.deepEqual([run.x, run.z], route.points[0]);
  assert.deepEqual([run.speed, run.elapsed, run.travel, run.airHeight], [0, 0, 0, 0]);
});

test('松手一段时间后，循线在直道上交替回转，手动刹车会立刻停用', ()=>{
  const run=startRun({grade:.23,assist:true});
  run.tick(2.57);
  assert.equal(run.automatic.active,false);
  run.tick(.9);
  assert.ok(run.automatic.active&&run.automatic.amplitude>1);
  const offsets=[];
  for(let sample=0;sample<120;sample++){
    run.tick(.1);offsets.push(run.offset);
  }
  assert.ok(Math.min(...offsets)<-1.2&&Math.max(...offsets)>1.2);
  assert.ok(offsets.every(offset=>Math.abs(offset)<7));
  run.tick(1/90,{brake:true});
  assert.equal(run.automatic.active,false);
  assert.equal(run.automatic.idle,0);
  run.tick(2.57);
  assert.equal(run.automatic.active,false);
});

test('弯道低速回转的幅度更大，高速和侧倾坡面会收窄，窄道和岔口有余量',()=>{
  function amplitude(speed,bend,roll=0,width=18,clear=1){
    const turns=new AutomaticTurns(),dt=1/90;
    for(let step=0;step<540;step++){
      turns.update({},speed,true,false,false,dt);
      turns.line(speed,width,.18,roll,bend,clear,dt);
    }
    return turns.amplitude;
  }
  assert.ok(amplitude(6,.43)>amplitude(6,0)+2);
  assert.ok(amplitude(21,.43)<amplitude(6,.43)*.5);
  assert.ok(amplitude(6,.43,.28)<amplitude(6,.43)*.85);
  assert.ok(amplitude(6,.43,0,9)<3.34);
  assert.equal(amplitude(6,.43,0,18,0),0);
});

test('超过百公里时速进入俯身直滑，减速后恢复回转，计时赛沿用原循线',()=>{
  const run=startRun({assist:true});
  run.tick(3);
  run.speed=31;
  run.tick(.27);
  assert.equal(run.automatic.sprint,true);
  assert.ok(run.straightTuck>.8);
  assert.equal(run.automatic.active,false);
  run.speed=27.5;
  run.tick(1/90);
  assert.equal(run.automatic.sprint,true);
  run.tick(.75);
  assert.equal(run.automatic.sprint,false);
  assert.equal(run.automatic.active,true);
  assert.ok(run.automatic.amplitude>.9);
  run.start(run.route,{timed:true});
  run.tick(4);
  assert.equal(run.automatic.active,false);
  assert.equal(run.straightTuck,0);
});

test('普通循线在接近 85 公里时速时仍有清晰的左右回转',()=>{
  const run=startRun({grade:.32,assist:true});
  run.speed=23.6;
  run.tick(5);
  const samples=[];
  for(let i=0;i<120;i++){
    run.tick(.10);
    samples.push({offset:run.offset,speed:run.speed,heading:run.travelHeading});
  }
  assert.ok(samples.every(p=>p.speed>19&&p.speed<100/3.6&&Math.abs(p.offset)<7.2));
  const range=key=>Math.max(...samples.map(sample=>sample[key]))-Math.min(...samples.map(sample=>sample[key]));
  assert.ok(range('offset')>7.6);
  assert.ok(range('heading')>25*Math.PI/180);
});
