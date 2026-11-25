import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {HeightField, ObstacleIndex, SkiRoute} from '../src/mountain.js';

// Unequal cell dimensions and a non-coplanar fourth corner distinguish the
// rendered triangles from a bilinear height field.
const field = new HeightField({
  bounds: {minX: -10, maxX: 10, minZ: 8, maxZ: 18},
  dem: {cols: 2, rows: 2, heights: [100, 120, 140, 200]}
});

test('雪面高度沿网格的两个三角面插值，接缝高度一致', () => {
  assert.equal(field.height(-5, 10.5), 115);
  assert.equal(field.height(5, 15.5), 165);
  assert.equal(field.height(5, 10.5), 125);
  assert.ok(Math.abs(field.height(5, 10.50001) - field.height(5, 10.49999)) < 0.001);
});

test('越过地形边界时采样最近的边缘', () => {
  for (const [x, z, height] of [[-50, 0, 100], [50, 0, 120], [-50, 30, 140], [50, 30, 200]]) {
    assert.ok(Math.abs(field.height(x, z) - height) < 0.001);
  }
});

test('随仓库分发的林地分布图与山体数据声明的栅格尺寸相符', () => {
  const source = new URL('../public/assets/geo/mountain.json', import.meta.url);
  const {rasters} = JSON.parse(readFileSync(source, 'utf8'));
  const forest = readFileSync(new URL(rasters.forest, source));
  assert.equal(forest.subarray(1, 4).toString('ascii'), 'PNG');
  assert.equal(forest.readUInt32BE(16), rasters.size);
  assert.equal(forest.readUInt32BE(20), rasters.size);
});

const route = new SkiRoute({points: [[0, 0], [0, -40], [30, -40]]}, {height: (x, z) => 1000 + z / 5});

test('雪道里程沿折线累积，查询区间以外的位置落在端点', () => {
  assert.equal(route.length, 70);
  assert.equal(route.startHeight - route.endHeight, 8);
  assert.deepEqual(route.at(-10), {x: 0, z: 0, index: 0});
  assert.deepEqual(route.at(45), {x: 5, z: -40, index: 1});
  assert.deepEqual(route.at(100), {x: 30, z: -40, index: 1});
});

test('滑手位置能投影到最近的雪道段或端点', () => {
  assert.deepEqual(route.closest(-3, -11), {distance: 3, along: 11});
  assert.deepEqual(route.closest(12, -44), {distance: 4, along: 52});
  assert.deepEqual(route.closest(36, -48), {distance: 10, along: 70});
});

test('循线滑过测绘折点和相邻短弯，雪板行进方向与弧线相切，内外侧的速度都连续', () => {
  const bends=new SkiRoute({points:[[0,0],[0,-4],[0,-40],[16,-54],[22,-52],[22,-52],[32,-46],[35,-70]]},field);
  const xy=(s,offset)=>{
    const f=bends.glideFrame(s);
    return [f.x-f.dz*offset,f.z+f.dx*offset];
  };
  assert.deepEqual(xy(0,0),bends.points[0]);
  assert.deepEqual(xy(bends.length,0),bends.points.at(-1));
  const h=.0005;
  for(const knot of bends.distances.slice(1,-1)){
    for(const s of [knot-10,knot,knot+10].filter(s=>s>h&&s<bends.length-h)){
      for(const offset of [-4,0,4]){
        const a=xy(s-h,offset),b=xy(s,offset),c=xy(s+h,offset);
        const kink=Math.hypot(c[0]-2*b[0]+a[0],c[1]-2*b[1]+a[1])/h;
        assert.ok(kink<.002,`lane ${offset} at ${s} m changed velocity by ${kink}`);
        if(offset===0){
          const frame=bends.glideFrame(s),vx=c[0]-a[0],vz=c[1]-a[1];
          assert.ok((vx*frame.dx+vz*frame.dz)/Math.hypot(vx,vz)>.999999);
        }
      }
    }
  }
});

test('雪场建筑和横跨索引格线的树干都把滑手推出障碍边界', () => {
  const obstacles = new ObstacleIndex([{footprint: [[-35, -10], [-20, -10], [-20, 10], [-35, 10]]}]);
  obstacles.tree(32, 45, 3);
  const wall = obstacles.contact(-22, 2);
  assert.ok(wall.x > -20 && wall.z === 2 && wall.nx === 1);
  assert.equal(obstacles.contact(wall.x, wall.z), null);
  const trunk = obstacles.contact(30, 45);
  assert.ok(trunk.x < 29 && trunk.z === 45 && trunk.nx === -1);
  assert.equal(obstacles.contact(trunk.x, trunk.z), null);
});
