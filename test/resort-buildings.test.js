import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as THREE from 'three';
import {prepareMountain} from '../src/mountain.js';
import {createResortDistricts} from '../src/resort.js';
import {resortBuildingPlaces,resortBuildingSpec} from '../src/resort-buildings.js';

const data=prepareMountain(JSON.parse(readFileSync(new URL('../public/assets/geo/mountain.json',import.meta.url))));

test('云顶世界酒店与丽苑八栋占用原地图轮廓，不退回单层占位',()=>{
  const worlds=data.buildings.filter(b=>b.id==='w468688157'||/^w136862224[0-7]$/.test(b.id));
  assert.equal(worlds.length,9);
  const labels=resortBuildingPlaces(data.buildings);
  assert.ok(labels.some(l=>l.name==='云顶世界酒店'&&l.id==='w468688157'));
  assert.ok(labels.some(l=>l.name==='云顶丽苑'&&l.id==='w1368622243'));
  for(const b of worlds){
    const spec=resortBuildingSpec(b);
    assert.equal(spec.floors,b.id==='w468688157'?5:6);
    if(spec.style==='liyuan')assert.equal(spec.source,'published');
    const model=createResortDistricts({...data,buildings:[b]});
    assert.ok(model.modeled.has(b.id));
    const box=new THREE.Box3().setFromObject(model.groups[0]);
    assert.ok(box.max.y-data.height(b.x,b.z)>12);
    for(const [x,z] of b.footprint)assert.ok(x>=box.min.x-.01&&x<=box.max.x+.01&&z>=box.min.z-.01&&z<=box.max.z+.01);
  }
});

test('万龙已定位建筑合批绘制，新增到达区轮廓同时进入碰撞数据',()=>{
  const {groups,modeled}=createResortDistricts(data),batches=groups.flatMap(g=>g.userData.buildingIds);
  assert.equal(new Set(batches).size,modeled.size);
  assert.ok(groups.length<modeled.size/2);
  for(const id of ['w259557731','w1032077621','w1153883030','w1153883045','w1153883034','w1153883035','w1153883036']){
    const b=data.buildings.find(v=>v.id===id);
    assert.ok(modeled.has(id)&&b);
    assert.equal(data.obstacles.contact(b.x,b.z)?.kind,'building');
  }
  assert.ok(!modeled.has('w468688715')&&!modeled.has('w1153883032'));
});
