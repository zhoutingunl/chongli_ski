// The browser tests wrap exported factories. Physics, animation, camera positioning and
// projection run unchanged. Only GPU drawing and the wall clock are replaced during replay.
let world, data, options, host, rider, camera, advanceFrame;

export function observeWorld(create) {
  return async (canvas, mountain, prefs, ...rest) => {
    world = await create(canvas, mountain, prefs, ...rest);
    data = mountain;
    options = prefs;
    host = canvas.parentElement;
    return world;
  };
}

export function observeRider(create) {
  return (...args) => {
    rider = create(...args);
    return rider;
  };
}

export function observeRenderer(Renderer) {
  return class extends Renderer {
    constructor(...args) {
      super(...args);
      const render = this.render.bind(this);
      this.render = (scene, view) => {
        camera = view;
        if (!advanceFrame) render(scene, view);
      };
    }
  };
}

function takeOverAnimationFrames() {
  const callbacks = new Map();
  let serial = 0;
  window.requestAnimationFrame = callback => {
    callbacks.set(++serial, callback);
    return serial;
  };
  window.cancelAnimationFrame = id => callbacks.delete(id);
  return time => {
    const due = [...callbacks];
    callbacks.clear();
    for (const [, callback] of due) callback(time);
  };
}

export function measureCamera(view, hz) {
  world.stop();
  advanceFrame ??= takeOverAnimationFrames();
  options.view = view;
  const {sim} = world;
  const route = data.allRoutes.find(r => r.id === 'wanlong-gold');
  let trafficSeed=76;
  sim.traffic.random=()=>((trafficSeed=(Math.imul(trafficSeed,1664525)+1013904223)>>>0)/2**32);
  let seed = 29;
  sim.moves.random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32);
  world.start(route);
  let now = 10000;
  const next = () => advanceFrame(now += 1000 / hz);
  while (sim.mode === 'run' && sim.along < 998 && now < 150000) next();
  if (sim.trail?.name !== '玉龙道') throw Error('The reference run did not reach Jade Dragon');

  const marks = Array.from({length: 11}, () => camera.position.clone());
  const probes = [];
  for (let d = 960; d <= 1170; d += 5) {
    const point = route.at(d), nextPoint = route.at(d + 1);
    const heading = Math.atan2(nextPoint.x - point.x, point.z - nextPoint.z);
    for (const cross of [-10, -5, 0, 5, 10]) {
      const x = point.x + Math.cos(heading) * cross, z = point.z + Math.sin(heading) * cross;
      probes.push(camera.position.clone().set(x, data.height(x, z) + .08, z));
    }
  }
  const scratch = camera.position.clone();
  function project(worldPoint, ground) {
    scratch.copy(worldPoint).applyMatrix4(camera.matrixWorldInverse);
    const depth = -scratch.z;
    scratch.applyMatrix4(camera.projectionMatrix);
    if (ground && (depth < 8 || depth > 35 || Math.abs(scratch.x) > .9 || Math.abs(scratch.y) > .85)) return null;
    return [scratch.x * host.clientWidth * .5, scratch.y * host.clientHeight * .5];
  }
  function deviation(a, b, c) {
    return Math.hypot(b[0] - (a[0] + c[0]) / 2, b[1] - (a[1] + c[1]) / 2);
  }
  const helmet = [], scenery = [];
  const visibleHead = view !== 'first' && view !== 'tips';
  const previousRoot = rider.group.position.clone();
  let older, previous, holds = 0;
  for (let i = 0; i < hz * 6; i++) {
    next();
    const root = rider.group.position;
    if (Math.hypot(root.x - previousRoot.x, root.z - previousRoot.z) < 1e-6) holds++;
    previousRoot.copy(root);
    camera.updateMatrixWorld(true);
    rider.shadowPose(marks);
    const sample = {head: project(marks[0], false), points: probes.map(point => project(point, true))};
    if (older) {
      if (visibleHead) helmet.push(deviation(older.head, previous.head, sample.head));
      const ground = [];
      sample.points.forEach((point, j) => {
        if (point && previous.points[j] && older.points[j]) ground.push(deviation(older.points[j], previous.points[j], point));
      });
      if (ground.length) {
        ground.sort((a, b) => a - b);
        scenery.push(ground[Math.floor(ground.length * .5)]);
      }
    }
    older = previous;
    previous = sample;
  }
  const p95 = samples => samples.sort((a, b) => a - b)[Math.floor(samples.length * .95)];
  return {holds, helmet: visibleHead ? p95(helmet) : null, scenery: p95(scenery), count: scenery.length};
}
