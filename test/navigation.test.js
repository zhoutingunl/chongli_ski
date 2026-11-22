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

function leaveSummit(heading, gear, side = 'wanlong', assist = true) {
  const run = new Descent(mountain, {assist, gear});
  run.start(navigation.departure(side, ...mountain.summitPlaces[side].position, heading));
  run.speed = 2.15;
  run.freeHeading(heading);
  return run;
}

function skiUntil(run, check, input, seconds) {
  for (let frame = 0; frame < seconds * 60 && !check(); frame++) skiFor(run, 1 / 60, input);
  assert.ok(check(), 'The skier should reach the requested position or entrance in time');
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

for (const [side, name, outlet] of [
  ['wanlong', '万龙', 'wanlong-long'], ['genting', '云顶', 'genting-valley']
]) {
  const {position: [x, z], heading, camera} = mountain.summitPlaces[side];
  test(name + '的山顶镜头、雪板与下坡道口对齐，前方雪面连续下降', () => {
    const view = Math.atan2(camera.target[0] - camera.position[0], camera.position[1] - camera.target[1]);
    assert.ok(Math.cos(view - heading) > 0.999);
    assert.ok(mountain.height(...camera.target) < mountain.height(...camera.position));
    const route = navigation.departure(side, x, z, heading);
    assert.equal(route.id, outlet);
    for (const metres of [5, 15, 30]) {
      const ahead = route.at(metres);
      assert.ok(mountain.height(x, z) - mountain.height(ahead.x, ahead.z) > metres * 0.06);
      assert.ok(mountain.height(x, z) - mountain.height(x + metres * Math.sin(heading),
        z - metres * Math.cos(heading)) > metres * 0.06);
    }
    let previous = mountain.height(x, z);
    for (let metres = 1; metres <= 30; metres++) {
      const p = route.at(metres);
      assert.equal(mountain.obstacles.contact(p.x, p.z), null);
      const height = mountain.height(p.x, p.z);
      assert.ok(height <= previous + 1e-6);
      previous = height;
    }
  });
  for (const gear of ['ski', 'board']) {
    test(name + (gear === 'ski' ? '双板' : '单板') + '轻点前进后，开关循线辅助都能靠坡度加速', () => {
      for (const assist of [true, false]) {
        const run = leaveSummit(heading, gear, side, assist);
        const start = run.ground;
        skiFor(run, 2);
        assert.ok(start - run.ground > 0.3 && run.speed > 2.75);
        const firstSpeed = run.speed;
        skiFor(run, 8);
        assert.ok(start - run.ground > 2.5 && run.travel > 32);
        assert.ok(run.speed > firstSpeed && run.speed * 3.6 > 18);
        if (assist) assert.equal(run.route.id, outlet);
      }
    });
  }
}

for (const [gear, label] of [['ski', '双板'], ['board', '单板']]) {
  for (const {heading, from, to, steer} of [
    {heading: summit.heading, from: long, to: gold, steer: -0.68},
    {heading: summit.heading - 0.70, from: gold, to: long, steer: 0.68}
  ]) {
    test(label + '从' + from.name + '出发后仍能转入' + to.name, () => {
      const otherHeading = navigation.summitHeading('wanlong', to.id);
      const other = navigation.departure('wanlong', ...summit.position, otherHeading);
      // The decision is spatial. Time to a mouth varies with downhill grade and equipment.
      for (const fraction of [0.22, 0.50, 0.72]) {
        const run = leaveSummit(heading, gear);
        const distance = fraction * Math.min(run.approach.endDistance, other.approach.endDistance);
        skiUntil(run, () => run.travel >= distance, {boost: true}, 10);
        assert.equal(run.route.id, from.id);
        skiUntil(run, () => run.route.id === to.id, {steer, boost: true}, 3.5);
        skiFor(run, 4, {boost: true});
        assert.equal(run.route.id, to.id, 'The selected line holds after releasing the key');
        assert.ok(run.travel > distance + 8);
      }
    });
  }
}

test('同一次滑行可以从长龙转金龙再回长龙', () => {
  const run = leaveSummit(summit.heading, 'ski');
  skiFor(run, 1.5);
  skiUntil(run, () => run.route.id === gold.id, {steer: -0.68}, 3);
  skiFor(run, 1.2);
  assert.equal(run.route.id, gold.id);
  skiUntil(run, () => run.route.id === long.id, {steer: 0.68}, 3.5);
  skiFor(run, 4);
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
