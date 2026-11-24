import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {prepareMountain} from '../src/mountain.js';
import {createPisteProgress} from '../src/piste-progress.js';
import {changeMapSort,defaultMapSort,mapSortFields,mapTravelActions,sortedMapRoutes} from '../src/map-routes.js';

const data=prepareMountain(JSON.parse(readFileSync(new URL('../public/assets/geo/mountain.json',import.meta.url))));
const wind=data.allRoutes.find(r=>r.name==='风龙道');
const marks=createPisteProgress(data,['wanlong/金龙道','wanlong/云龙道']);

test('地图默认把未滑道放在前面，四种字段均按显示值正反排序，不修改路线目录',()=>{
  const routes=data.allRoutes.filter(r=>(r.catalogResort||r.resort)==='wanlong');
  const original=routes.map(r=>r.id),names=new Intl.Collator('zh-CN',{numeric:true});
  for(const by of mapSortFields){
    const compare=(a,b)=>{
      if(by==='name')return names.compare(a.name,b.name);
      if(by==='drop')return a.pisteDrop-b.pisteDrop;
      if(by==='length')return (a.pisteDistance??a.length)-(b.pisteDistance??b.length);
      const x=marks.forRoute(a),y=marks.forRoute(b);
      return x.ridden/x.total-y.ridden/y.total;
    };
    const asc={by,descending:false},desc=changeMapSort(asc,by);
    assert.deepEqual(changeMapSort(desc,by),asc);
    for(const order of [asc,desc]){
      const sorted=sortedMapRoutes(routes,marks,order,'zh');
      assert.equal(sorted.length,routes.length);
      assert.ok(sorted.slice(1).every((r,i)=>compare(sorted[i],r)*(order.descending?-1:1)<=0));
    }
  }
  assert.deepEqual(defaultMapSort,{by:'visited',descending:false});
  assert.deepEqual(routes.map(r=>r.id),original);
  assert.equal(marks.forRoute(sortedMapRoutes(routes,marks,defaultMapSort,'zh')[0]).ridden,0);
  assert.ok(data.allRoutes.every(r=>marks.forRoute(r).total>0));
});

test('短雪道的垂降按道口到道尾测量，区分风龙道本段和通往山脚的全程',()=>{
  const first=wind.points[wind.primaryStartIndex],last=wind.points[wind.primaryEndIndex];
  assert.equal(wind.pisteDrop,Math.round(data.height(...first)-data.height(...last)));
  assert.ok(wind.pisteDrop>0&&wind.pisteDrop<wind.drop);
  assert.ok(wind.pisteDistance<wind.length);
});

test('途中点风龙道永远可以去起点，当前正滑此线、即将到岔口和共用出口均有独立操作',()=>{
  const pos=wind.at(wind.length*.78);
  const sim={...pos,route:wind,junctionFor:()=>null};
  assert.deepEqual(mapTravelActions('run',false,wind,sim),['resume']);
  assert.deepEqual(mapTravelActions('run',true,wind,sim),['trailhead','resume']);
  sim.route=data.routes[0];
  assert.deepEqual(mapTravelActions('run',true,wind,sim),['trailhead','join']);
  sim.junctionFor=()=>({});assert.deepEqual(mapTravelActions('run',true,wind,sim),['trailhead','junction']);
  sim.junctionFor=()=>null;sim.x+=2000;
  assert.deepEqual(mapTravelActions('run',true,wind,sim),['trailhead']);
  assert.deepEqual(mapTravelActions('summit',false,wind,sim,false),['choose']);
  assert.deepEqual(mapTravelActions('summit',true,wind,sim,true),['summit']);
});
