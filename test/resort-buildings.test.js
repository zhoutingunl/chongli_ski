import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as THREE from 'three';
import {prepareMountain} from '../src/mountain.js';
import {createResortDistricts} from '../src/resort.js';
import {resortBuildingPlaces,resortBuildingSpec} from '../src/resort-buildings.js';
import {drawBuildingFootprints} from '../src/xhs/flat-world.js';
import {TrailMap} from '../src/map.js';

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

test('坡上屋檐露出雪面，六座具名建筑的入口都落在正门位置的积雪上',()=>{
  const v=new THREE.Vector3();
  let signs=0;
  for(const b of data.buildings.filter(resortBuildingSpec)){
    const group=createResortDistricts({...data,buildings:[b]}).groups[0];
    const roof=group.children.find(m=>m.name==='solid');
    const eave=new THREE.Box3().setFromObject(roof).min.y;
    for(let i=0;i<b.footprint.length;i++){
      const [x,z]=b.footprint[i],[nx,nz]=b.footprint[(i+1)%b.footprint.length];
      const steps=Math.ceil(Math.hypot(nx-x,nz-z)/1.7);
      for(let j=0;j<=steps;j++){
        const snow=data.height(x+(nx-x)*j/steps,z+(nz-z)*j/steps);
        assert.ok(eave-snow>3.3,b.id+' uphill eave');
      }
    }
    if(!resortBuildingSpec(b).sign)continue;
    const plate=group.getObjectByName('districtLabel');
    const center=new THREE.Box3().setFromObject(plate).getCenter(new THREE.Vector3());
    const normal=v.fromBufferAttribute(plate.geometry.attributes.normal,0);
    center.addScaledVector(normal,-.22);
    assert.ok(Math.abs(center.y-2.55-data.height(center.x,center.z))<.015,b.id+' entrance');
    signs++;
  }
  assert.equal(signs,6);
});

test('轻量画质从缆车远望仍保留楼体轮廓，靠近后再绘制窗户、阳台和招牌',()=>{
  const b=data.buildings.find(b=>b.id==='w1368622243');
  const districts=createResortDistricts({...data,buildings:[b]});
  const group=districts.groups[0],sign=group.getObjectByName('districtLabel');
  function visibleMeshes(){
    const meshes=[];
    group.traverseVisible(o=>{if(o.isMesh)meshes.push(o);});
    return meshes;
  }
  districts.locate(b.x+2200,b.z,'lite');
  const distant=visibleMeshes();
  assert.ok(distant.length>0&&distant.length<=2);
  assert.ok(!distant.includes(sign));
  districts.locate(b.x,b.z,'lite');
  assert.ok(visibleMeshes().includes(sign));
  assert.ok(distant.every(mesh=>visibleMeshes().includes(mesh)));
});

test('轻量雪道视图绘制实际碰撞轮廓，中心在屏外的大楼也能显示伸入视野的部分',()=>{
  const b=data.buildings.find(b=>b.id==='w1153883034');
  const radius=Math.max(...b.footprint.map(([x,z])=>Math.hypot(x-b.x,z-b.z)));
  const project=(x,z)=>[x-b.x-1,z-b.z+30];
  const vertices=[];
  const ctx={beginPath(){},moveTo(...p){vertices.push(p);},lineTo(...p){vertices.push(p);},
    closePath(){},fill(){},stroke(){}};
  drawBuildingFootprints(ctx,[{...b,radius},{...b,x:b.x+2000,radius}],project,1,100,100,false);
  assert.deepEqual(vertices,b.footprint.map(p=>project(...p)));
  assert.equal(data.obstacles.contact(b.x,b.z)?.kind,'building');
});

test('大地图放大到丽苑时，只标注视野里的地标',t=>{
  const saved=globalThis.devicePixelRatio;
  globalThis.devicePixelRatio=1;
  t.after(()=>{if(saved===undefined)delete globalThis.devicePixelRatio;else globalThis.devicePixelRatio=saved;});
  const places=resortBuildingPlaces(data.buildings),place=places.find(l=>l.name==='云顶丽苑');
  const labels=[],ctx=new Proxy({
    measureText:text=>({width:text.length*10}),fillText:text=>labels.push(text)
  },{get:(target,key)=>target[key]??(()=>{})});
  const map=Object.assign(Object.create(TrailMap.prototype),{
    el:{clientWidth:360,clientHeight:220},ctx,data,mini:false,buildingPlaces:places,
    box:{minX:place.x-180,maxX:place.x+180,minZ:place.z-110,maxZ:place.z+110},
    panX:0,panZ:0,zoom:1,lines:[]
  });
  map.draw();
  assert.ok(labels.includes('云顶丽苑'));
  assert.ok(!labels.includes('万龙雪场')&&!labels.includes('云顶雪场')&&!labels.includes('金花阁'));
});
