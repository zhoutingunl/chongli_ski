import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {prepareMountain} from '../src/mountain.js';
import {createSkiNavigation} from '../src/navigation.js';
import {Descent} from '../src/simulation.js';

const source = new URL('../public/assets/geo/mountain.json', import.meta.url);
const mountain = prepareMountain(JSON.parse(readFileSync(source, 'utf8')));
const navigation = createSkiNavigation(mountain);
const summit = mountain.summitPlaces.wanlong;
const routes = new Map(mountain.allRoutes.map(route => [route.id, route]));
const long = routes.get('wanlong-long');
const gold = routes.get('wanlong-gold');

function skiFor(run, seconds, input = {}) {
  const dt = 1 / 60;
  for (let frame = 0; frame < Math.round(seconds / dt); frame++) {
    const {x, z, speed} = run;
    run.tick(dt, input);
    const displacement = Math.hypot(run.x - x, run.z - z);
    assert.ok(displacement < (Math.max(speed, run.speed) + 1) * dt + 0.15,
      'Switching routes must keep the boots on a continuous path');
  }
}

function leaveSummit(heading, gear) {
  const run = new Descent(mountain, {assist: true, gear});
  run.start(navigation.departure('wanlong', ...summit.position, heading));
  run.speed = 2.15;
  run.freeHeading(heading);
  return run;
}

function placeOnRoute(route, along, speed) {
  const run = new Descent(mountain, {assist: true, gear: 'ski'});
  run.start(route);
  const frame = route.frame(along);
  Object.assign(run, {
    along, speed, x: frame.x, z: frame.z, planIndex: frame.index,
    heading: frame.angle, travelHeading: frame.angle
  });
  run.ground = run.y = mountain.height(run.x, run.z);
  run.surface();
  return run;
}

function signNames(run) {
  const options = navigation.nearbyChoices(run)?.options ?? [];
  assert.ok(options.every(option => option.name && option.selectable && Number.isFinite(option.heading)));
  const names = options.map(option => option.name);
  assert.equal(new Set(names).size, names.length, 'Each direction should be signposted only once');
  return names;
}

test('万龙山顶给出四个各自可达的道口', () => {
  const [x, z] = summit.position;
  assert.deepEqual(new Set(signNames({mode: 'summit', x, z, route: long})),
    new Set(['金龙道', '长龙道', '银龙道', '海龙道']));
});

for (const [gear, label] of [['ski', '双板'], ['board', '单板']]) {
  for (const {heading, from, to, steer} of [
    {heading: summit.heading, from: long, to: gold, steer: -0.68},
    {heading: summit.heading - 0.70, from: gold, to: long, steer: 0.68}
  ]) {
    test(label + '从' + from.name + '出发后仍能转入' + to.name, () => {
      for (const delay of [5, 11]) {
        const run = leaveSummit(heading, gear);
        skiFor(run, delay, {boost: true});
        assert.equal(run.route.id, from.id);
        skiFor(run, 0.82, {steer, boost: true});
        skiFor(run, 4, {boost: true});
        assert.equal(run.route.id, to.id, 'Turn after ' + delay + ' seconds');
        assert.ok(run.elapsed > delay && run.travel > 8);
      }
    });
  }
}

test('同一次滑行可以从长龙转金龙再回长龙', () => {
  const run = leaveSummit(summit.heading, 'ski');
  skiFor(run, 5, {boost: true});
  skiFor(run, 0.65, {steer: -0.68, boost: true});
  skiFor(run, 3, {boost: true});
  assert.equal(run.route.id, gold.id);
  skiFor(run, 0.82, {steer: 0.68, boost: true});
  skiFor(run, 4, {boost: true});
  assert.equal(run.route.id, long.id);
});

test('沿长龙先看到至云顶的蹬坡支路，到下一处岔口才提示玉龙', () => {
  const junctions = navigation.stationsOn(long);
  const climb = junctions.find(junction => junction.namedExits.some(exit => exit.name.includes('蹬坡')));
  const jade = junctions.find(junction => junction.namedExits.some(exit => exit.name === '玉龙道'));
  assert.ok(climb && jade && climb.along < jade.along);
  const first = signNames(placeOnRoute(long, climb.along - 25, 12));
  assert.ok(first.some(name => name.includes('至云顶')));
  assert.ok(!first.includes('玉龙道'));
  assert.ok(signNames(placeOnRoute(long, jade.along - 25, 12)).includes('玉龙道'));
});

test('翠菊花反向上坡时松开会停，持续蹬坡能缓慢爬升', () => {
  const climb = navigation.canonical('wanlong-aster-climb');
  const coast = placeOnRoute(climb, 46, 4);
  const push = placeOnRoute(climb, 46, 4);
  skiFor(coast, 15);
  skiFor(push, 15, {boost: true});
  assert.equal(coast.speed, 0);
  assert.ok(push.ground - coast.ground > 1);
  assert.ok(push.speed > 0.4 && push.speed < 2.5);
});

test('停住时仍能用方向键转身', () => {
  const run = placeOnRoute(long, 150, 0);
  const facing = run.travelHeading;
  skiFor(run, 2, {steer: 0.68, brake: true});
  assert.ok(Math.abs(run.travelHeading - facing) > 0.65);
});

for (const [region, name] of [['wanlong', '万龙'], ['genting', '云顶']]) {
  test(name + '的 32 条公众雪道都有独立目录项、可滑区间与山脚索道', () => {
    const entries = mountain.trailCatalog.filter(entry => entry.resort === region);
    assert.equal(entries.length, 32);
    assert.equal(new Set(entries.map(entry => entry.routeId)).size, entries.length);
    for (const entry of entries) {
      const route = routes.get(entry.routeId);
      assert.ok(route && route.pisteDistance > 0 && route.primaryEndIndex > route.primaryStartIndex, entry.routeId);
      assert.equal(route.finishKind, 'base', entry.routeId);
      assert.ok(mountain.lifts.some(lift => lift.id === route.finishLiftId), entry.routeId);
    }
  });
}
