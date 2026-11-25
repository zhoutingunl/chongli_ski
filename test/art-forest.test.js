import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import * as THREE from 'three';
import {groveSelection,nearbyGrove,woodlandVista} from '../src/art-forest.js';
import {scenery} from '../src/scenery.js';
import {woodlandTree} from '../art/woodland-mesh.js';
import {designs} from '../art/woodland-palettes.js';
import atlases from '../src/grove-atlases.json' with {type:'json'};
import surfaces from '../src/art-surfaces.json' with {type:'json'};

test('每种画境有三种立体树种、两种树形，树根与树高符合原地理实例',()=>{
  const artist=scenery.filter(s=>s.group==='art').map(s=>s.id).sort();
  assert.deepEqual(Object.keys(designs).sort(),artist);assert.deepEqual(Object.keys(atlases).sort(),artist);
  const uniqueGeometry=new Set();
  for(const design of Object.values(designs))for(let species=0;species<3;species++)for(let variation=0;variation<2;variation++){
    const tree=woodlandTree(design,species,variation),p=tree.positions;
    assert.equal(tree.pigments.length*3,p.length);assert.equal(tree.brush.length*3,p.length*2);
    assert.equal(tree.shades.length,tree.pigments.length);
    assert.ok(tree.pigments.includes(0)&&tree.pigments.includes(5));
    let top=-Infinity,base=Infinity,reachX=0,reachZ=0;
    for(let i=0;i<p.length;i+=3){
      reachX=Math.max(reachX,Math.abs(p[i]));reachZ=Math.max(reachZ,Math.abs(p[i+2]));
      base=Math.min(base,p[i+1]);top=Math.max(top,p[i+1]);
    }
    assert.ok(base>-.05&&base<=.001&&Math.abs(top-1)<.0001);
    assert.ok(reachX>.15&&reachZ>.15&&reachX<.64&&reachZ<.64);
    uniqueGeometry.add(createHash('sha256').update(Buffer.from(new Float32Array(p).buffer)).digest('hex'));
  }
  assert.equal(uniqueGeometry.size,36);
  assert.deepEqual(woodlandTree(designs.ink,2,1),woodlandTree(designs.ink,2,1));
});

test('图集与画布文件可离线读取，文件名与发布内容散列一致',async()=>{
  const files=[...Object.values(atlases),...Object.values(surfaces).flatMap(Object.values)];
  for(const name of files){
    const bytes=await readFile(new URL('../public/'+name,import.meta.url));
    assert.equal(bytes.toString('ascii',8,12),'WEBP');
    assert.ok(name.includes(createHash('sha256').update(bytes).digest('hex').slice(0,10)));
  }
});

test('自然景观零加载，快速切换、原景对照、重试和缓存淘汰保持所选画境',async()=>{
  const tick=()=>new Promise(f=>setImmediate(f));
  const pending=new Map(),calls=[],shown=[],disposed=[],signals=[];
  const library=groveSelection(id=>{calls.push(id);return new Promise((resolve,reject)=>pending.set(id,{resolve,reject}));},
    scene=>shown.push(scene?.id||null),(id,status)=>signals.push([id,status]));
  const done=id=>pending.get(id).resolve({id,dispose:()=>disposed.push(id)});
  library.select('gold');library.select(null);await tick();assert.deepEqual(calls,[]);
  library.select('ink');library.select('monet');library.select('ink');await tick();
  assert.deepEqual(calls,['ink','monet']);done('monet');await tick();assert.deepEqual(shown,[]);
  library.select(null);done('ink');await tick();assert.deepEqual(shown,[]);
  library.select('ink');assert.equal(shown.at(-1),'ink');
  library.select('starry');await tick();pending.get('starry').reject(Error('offline'));await tick();
  assert.deepEqual(signals.at(-1),['starry','failed']);assert.equal(shown.at(-1),null);
  library.select('starry');await tick();assert.equal(calls.filter(id=>id==='starry').length,1);
  library.retry();await tick();done('starry');await tick();assert.equal(shown.at(-1),'starry');
  assert.deepEqual(disposed,['monet']);library.select('gold');assert.equal(shown.at(-1),null);
});

test('近景与远树按相同位置和树种交接，画质预算和边缘迟滞生效',()=>{
  const count=70,positions=[],forms=[];
  for(let i=0;i<count;i++){positions.push(i,1800,0);forms.push(i%2?-9:9,10,i%3,1);}
  const g=new THREE.InstancedBufferGeometry();g.instanceCount=count;
  g.setAttribute('location',new THREE.InstancedBufferAttribute(new Float32Array(positions),3));
  g.setAttribute('form',new THREE.InstancedBufferAttribute(new Float32Array(forms),4));
  g.boundingSphere=new THREE.Sphere(new THREE.Vector3(35,1800,0),340);
  const mesh=new THREE.Mesh(g),chunks=[mesh];
  for(const [q,n] of [['lite',10],['auto',24],['high',40]]){
    const trees=nearbyGrove(chunks,0,0,q);assert.equal(trees.length,n);
    assert.equal(new Set(trees.map(t=>t.key)).size,n);
    for(const tree of trees){assert.equal(tree.slot>>1,tree.i%3);assert.deepEqual([tree.x,tree.y,tree.z,tree.w,tree.h],[tree.i,1800,0,9,10]);}
  }
  const earlier=nearbyGrove(chunks,8.49,0,'lite');
  assert.deepEqual(new Set(nearbyGrove(chunks,8.51,0,'lite',new Set(earlier.map(t=>t.key))).map(t=>t.key)),new Set(earlier.map(t=>t.key)));
  assert.deepEqual(nearbyGrove(chunks,-400,0,'high'),[]);
});

test('三索参照机位挑选背后有山谷的真树，守在站台原处',()=>{
  const trees=[{x:32,y:1800,z:0,h:10,slot:1},{x:-34,y:1800,z:0,h:10,slot:1}];
  const height=(x,z)=>1800-x*.30;
  assert.deepEqual(woodlandVista(trees,0,1800,0,height),{x:1,z:0});
  assert.equal(woodlandVista([],0,1800,0,height),null);
});

test('同机位看树可在六种画境之间保留，回到自然景观或关闭试景时释放',async()=>{
  const {SceneryTrial}=await import('../src/scenery.js');
  const trial=new SceneryTrial();trial.enter({length:1000});
  trial.select('ink');trial.tree=true;trial.hasTree=true;trial.fromThirdLift=true;
  trial.select('monet');assert.ok(trial.tree);
  trial.original=true;assert.ok(trial.tree);
  trial.select('cloudsea');assert.equal(trial.tree,false);
  trial.close();assert.equal(trial.hasTree,false);assert.equal(trial.fromThirdLift,false);
});
