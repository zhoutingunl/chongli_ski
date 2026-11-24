import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {HeightField,prepareMountain} from '../src/mountain.js';
import {addTerrainTiles} from '../src/landscape.js';
import {getRiderDimensions} from '../src/rider.js';
import {Descent} from '../src/simulation.js';
import {Scene,MeshBasicMaterial,Vector3} from 'three';
import {createTerrainDetail} from '../src/terrain-detail.js';
import {snowResponse} from '../src/snow-terrain.js';

const data=prepareMountain(JSON.parse(readFileSync(new URL('../public/assets/geo/mountain.json',import.meta.url))));
const surface=data.snowTerrain;
const position=(f,s,x)=>[f.x+s*f.dx-x*f.dz,f.z+s*f.dz+x*f.dx];

test('云顶 U 型池保留平底、两侧槽壁和自然连接雪道的进出口',()=>{
  const f=surface.features.find(f=>f.kind==='pipe');
  const midway=(f.start+f.end)/2;
  const height=(across,s=midway)=>data.height(...position(f,s,across));
  assert.equal(f.end-f.start,220);
  for(const side of [-1,1]){
    assert.ok(Math.abs(height(side*3)-height(0))<.02);
    assert.ok(height(side*7)-height(0)>.85);
    assert.ok(Math.abs(height(side*11)-height(0)-7.2)<.02);
    assert.ok(surface.sample(...position(f,midway,side*10.7)).rim>.8);
    assert.ok(Math.abs(height(side*11,f.start+.02)-height(side*11,f.start-.02))<.06);
  }
});

test('两段云顶蘑菇道有各自的雪包，普通金龙道保留原有雪面',()=>{
  const courses=surface.features.filter(f=>f.kind==='moguls');
  assert.equal(courses.length,2);
  for(const f of courses){
    const heights=[];
    for(let s=32;s<75;s+=.4)for(let x=-4;x<4;x+=.55){
      const p=position(f,s,x),sample=surface.sample(...p);
      const groomedCrossing=data.apronIndex.near(...p).distance<=22*.24;
      assert.equal(sample.kind,groomedCrossing?'groomed':'moguls');
      assert.ok(Math.abs(data.height(...p)-data.field.height(...p)-sample.relief)<1e-9);
      heights.push(sample.relief);
    }
    assert.ok(Math.max(...heights)-Math.min(...heights)>.48);
  }
  const gold=data.trails.find(t=>t.name==='金龙道');
  for(const [x,z] of gold.points){
    assert.equal(surface.sample(x,z).kind,'groomed');
    assert.equal(data.height(x,z),data.field.height(x,z));
  }
});

test('大奔头厚雪下沉随装备受压面积和速度变化，越过凸面会卸载',()=>{
  const trail=data.trails.find(t=>t.id==='w1353185034');
  const [x,z]=trail.points[Math.floor(trail.points.length/2)];
  const snow=surface.sample(x,z);
  assert.equal(snow.kind,'powder');
  assert.ok(snow.depth>.25);
  const ski=getRiderDimensions({gear:'ski'}),board=getRiderDimensions({gear:'board'});
  const apply=(v,d,isBoard=false,h=data.height)=>snowResponse(h,x,z,0,1,v,snow,d,isBoard);
  assert.ok(apply(4,ski).sink>apply(4,board,true).sink);
  assert.ok(apply(4,ski).sink>apply(21,ski).sink*2);
  assert.ok(apply(4,ski).sink>apply(4,getRiderDimensions({gender:'boy'})).sink);
  const crest=(_x,at)=>-.048*(at-z)**2;
  assert.ok(apply(17,ski,false,crest).load<apply(5,ski,false,crest).load*4);
  assert.ok(apply(17,ski,false,(_x,at)=>-crest(_x,at)).load>1);
});

test('单板和双板都能滑过蘑菇段，出现压缩和腾空后落地',()=>{
  const route=data.allRoutes.find(r=>r.id==='genting-venue-zipper-moguls');
  for(const gear of ['ski','board']){
    const descent=new Descent(data,{gear,assist:true},getRiderDimensions({gear}));
    descent.start(route);
    let maxLoad=0, minLoad=0, flew=false, landed=false;
    for(let step=0;step<3600&&descent.along<250;step++){
      const wasAirborne=descent.airborne;
      descent.tick(1/90,{boost:true});
      maxLoad=Math.max(maxLoad,descent.groundLoad);minLoad=Math.min(minLoad,descent.groundLoad);
      flew||=descent.airHeight>.03;
      landed||=wasAirborne&&!descent.airborne;
      if(!descent.airborne)assert.ok(Math.abs(descent.y-data.height(descent.x,descent.z))<1e-8);
    }
    assert.ok(descent.along>=250);
    assert.ok(maxLoad>.95&&minLoad<-.45);
    assert.ok(flew&&landed,gear);
  }
});

test('玉龙道下段的细雪网格在两个三角面和相邻瓦片上共用连续的地形法线',()=>{
  const field=data.field, jade=data.trails.find(t=>t.name==='玉龙道');
  const [x,z]=jade.points.reduce((a,b)=>Math.abs(data.height(...b)-1732)<Math.abs(data.height(...a)-1732)?b:a);
  const scene=new Scene(),material=new MeshBasicMaterial();
  const snow={features:[],sample:()=>({kind:'groomed',strength:0,relief:0,rim:0})};
  const detail=createTerrainDetail(scene,field,snow,material);
  const vertex=(c,r)=>new Vector3().fromArray(field.vertexNormals,3*(r*field.cols+c));
  for(const quality of ['lite','high']){
    detail.locate(x,z,quality);
    for(const {geometry,userData} of scene.children){
      const {position,normal}=geometry.attributes;
      const c=Math.round((position.getX(0)-field.bounds.minX)/field.dx);
      const r=Math.round((position.getZ(0)-field.bounds.minZ)/field.dz);
      const stride=userData.steps+1;
      for(let j=0;j<stride;j+=2)for(let i=0;i<stride;i+=2){
        const u=i/(stride-1),v=j/(stride-1),t=1-u-v;
        const expected=(t>=0?vertex(c,r):vertex(c+1,r+1)).multiplyScalar(Math.abs(t))
          .addScaledVector(vertex(c+1,r),t>=0?u:1-v).addScaledVector(vertex(c,r+1),t>=0?v:1-u).normalize();
        assert.ok(expected.distanceTo(new Vector3().fromBufferAttribute(normal,j*stride+i))<1e-6);
      }
    }
  }
});

test('远细雪面逐格交接，移动、切换画质、跨地形块边界和离开后均无漏画或双画',()=>{
  const cols=58,rows=9,cell=32;
  const bounds={minX:0,minZ:0,maxX:(cols-1)*cell,maxZ:(rows-1)*cell};
  const heights=Array.from({length:cols*rows},(_,i)=>1800+Math.sin(i%cols*.34)*25-Math.floor(i/cols)*4);
  const field=new HeightField({bounds,dem:{cols,rows,heights}});
  const feature={x:4*cell,z:3*cell,dx:1,dz:0,start:0,end:26,width:9,
    bounds:{minX:4*cell,maxX:5*cell,minZ:3*cell-9,maxZ:3*cell+9}};
  const material=new MeshBasicMaterial(),coarse=new Scene(),fine=new Scene();
  const cover=addTerrainTiles(coarse,field,material);
  const fineSurface={features:[feature],sample:()=>({kind:'groomed',strength:0,relief:.6,rim:0})};
  const detail=createTerrainDetail(fine,field,fineSurface,material,cover);
  assert.ok(detail.isFixed(4,3));
  const cells=(cols-1)*(rows-1);
  for(const [x,z,quality] of [[4,3,'lite'],[51,4,'high'],[52,4,'lite'],[56,7,'high'],[52,4,'high'],[0,0,'lite'],[51,4,'high']]){
    detail.locate((x+.5)*cell,(z+.5)*cell,quality);
    const coarseTris=new Uint8Array(cells),fineTiles=new Uint8Array(cells);
    for(const {geometry} of coarse.children){
      const index=geometry.index.array,p=geometry.attributes.position;
      for(let i=0;i<index.length;i+=3){
        const [a,b,c]=index.subarray(i,i+3);
        if(a===b||b===c||a===c)continue;
        const col=Math.floor((p.getX(a)+p.getX(b)+p.getX(c))/(3*cell));
        const row=Math.floor((p.getZ(a)+p.getZ(b)+p.getZ(c))/(3*cell));
        coarseTris[row*(cols-1)+col]++;
      }
    }
    let sealedBorders=0;
    for(const tile of fine.children){
      const p=tile.geometry.attributes.position,n=tile.userData.steps+1;
      const c=Math.round(p.getX(0)/cell),r=Math.round(p.getZ(0)/cell);
      fineTiles[r*(cols-1)+c]++;
      if(p.count===n*n)continue;
      sealedBorders++;
      // The lower strip covers rounding gaps at the coarse/fine T-junctions.
      const top=field.height(p.getX(n*n),p.getZ(n*n));
      assert.ok(p.getY(n*n)<top-.3&&p.getY(n*n)>top-.9);
      assert.ok(tile.geometry.index.count>6*(n-1)**2);
    }
    assert.ok(sealedBorders>0);
    for(let i=0;i<cells;i++){
      const refined=detail.stepsAt(i%(cols-1),Math.floor(i/(cols-1)))>1;
      assert.equal(fineTiles[i],refined?1:0);
      assert.equal(coarseTris[i],refined?0:2);
    }
  }
});
