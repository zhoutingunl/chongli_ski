import assert from 'node:assert/strict';
import test from 'node:test';
import {MeshBasicMaterial,Scene,Vector3} from 'three';
import {createRider} from '../src/rider.js';
import {cutResponse,edgeFraction,newSkiContact,skiLoad} from '../src/edge-contact.js';
import {skiGrooves} from '../src/ski-grooves.js';

const angle=Math.PI/180;
const hill={height:(x,z)=>.085*x+Math.tan(15*angle)*z};
const normal=new Vector3(-.085,1,-Math.tan(15*angle)).normalize();
const assertNear=(a,b,eps)=>assert.ok(Math.abs(a-b)<=eps,`${a} ≠ ${b} (±${eps})`);

function skiFixture(t,gender='male',gear='ski'){
  const rider=createRider({gender,gear});t.after(()=>rider.dispose());
  const state={mode:'run',gear,data:hill,onTrail:true,snowTerrain:{kind:'groomed'},x:17,z:-93,
    heading:0,travelHeading:0,speed:80/3.6,slope:15,edge:0,pressure:.95,snowSoftness:.14,snowSink:.011};
  const ground=hill.height(state.x,state.z);
  rider.group.position.set(state.x,ground+.004-state.snowSink,state.z);
  rider.group.quaternion.setFromUnitVectors(new Vector3(0,1,0),normal);
  let time=0;
  const advance=(edge,settings={},frames=85)=>{
    Object.assign(state,{edge,steer:edge,curve:edge*.58},settings);
    for(let i=0;i<frames;i++){time+=1/90;state.elapsed=time;rider.update(state,1/90,time);}
    return rider.skiFeet;
  };
  return {rider,advance};
}
const clearance=p=>(p.y-hill.height(p.x,p.z))*normal.y;

test('斜坡上的承重刃与可见板腰重合，左右转交换外脚，另一条刃和板头抬起',t=>{
  for(const gender of ['male','girl']){
    const {advance,rider}=skiFixture(t,gender);
    for(const sign of [-1,1]){
      const feet=advance(sign*.89),outer=feet[sign>0?0:1],inside=feet[sign>0?1:0];
      assert.ok(outer.active&&inside.active&&outer.weight>.8&&inside.weight<.2);
      assertNear(outer.weight+inside.weight,1,1e-8);
      const size=rider.dimensions.scale;
      for(const f of feet){
        const ski=rider.group.getObjectByName(f.leg<0?'Left ski':'Right ski');
        const localLength=rider.dimensions.lengthScale/size,half=rider.dimensions.waistWidth/size/2;
        for(const [x,reported] of [[-half,f.left],[half,f.right]]){
          const meshPoint=ski.localToWorld(new Vector3(x,.012,.05*localLength));
          assertNear(meshPoint.distanceTo(reported),0,1e-7);
        }
        assertNear(f.edgeRise,rider.dimensions.waistWidth*Math.sin(f.edgeAngle),1e-7);
        assertNear(clearance(f.boot),Math.min(clearance(f.left),clearance(f.right)),1e-6);
        assert.ok(clearance(f.boot)<0&&clearance(f.boot)>-.026*size);
        assert.ok(Math.max(clearance(f.left),clearance(f.right))>.023*size);
        assert.ok(clearance(f.nose)>.035*size);
      }
      assert.ok(outer.clearance<inside.clearance-.001*size);
    }
  }
});

test('换刃以平板过渡，实测板腰宽度决定高度差',t=>{
  const {advance}=skiFixture(t);
  const initial=advance(-.9).map(f=>f.edgeAngle);
  const seq=[];
  for(let i=0;i<72;i++)seq.push(advance(.9,{},1).map(f=>f.edgeAngle));
  for(let i=0;i<2;i++){
    assert.ok(initial[i]*seq.at(-1)[i]<0);
    assert.ok(Math.min(...seq.map(frame=>Math.abs(frame[i]))) < .10);
    assertNear(edgeFraction(0,.079),.5,1e-8);
  }
  assertNear(.08*Math.sin(45*angle),.0565685,1e-7);
});

test('单脚平衡、腾空、离道和更换单板不会沿用上一帧的双板接触',t=>{
  const {advance}=skiFixture(t);
  advance(.84);
  const balance=advance(.84,{moves:{balance:1}});
  assert.equal(balance[0].active,true);assert.equal(balance[1].active,false);
  assert.ok(balance[1].clearance>.055);
  for(const f of advance(.8,{airborne:true,airHeight:.27,moves:null},1))assert.equal(f.active,false);
  assert.ok(advance(.65,{airborne:false,airHeight:0}).every(f=>f.active));
  assert.ok(advance(.65,{onTrail:false},1).every(f=>!f.active));
  assert.ok(advance(.65,{onTrail:true,snowTerrain:{kind:'moguls'}},1).every(f=>!f.active));
  assert.equal(skiFixture(t,'male','board').advance(.6).length,0);
});

const velocity=80/3.6,dim={waistWidth:.079,deckLength:1.753};
function footprint(x,z,leg=-1){
  const f=newSkiContact(leg);f.active=true;f.weight=.82;f.edgeAngle=Math.PI/4;
  f.boot.set(x,0,z);f.rear.set(x,0,z+.52);f.fore.set(x,0,z-.55);
  f.across.set(1,0,0);f.normal.set(0,1,0);return f;
}
function snowPatch(){
  const scene=new Scene(),material=new MeshBasicMaterial(),data={height:()=>0};
  const grooves=skiGrooves(scene,data,material);
  return {grooves,history:scene.getObjectByName('Packed ski grooves').geometry,
    live:scene.getObjectByName('Working ski edges').geometry};
}
function pointAt(geometry,segment,which=0,column=3){
  return new Vector3().fromBufferAttribute(geometry.attributes.position,(segment*2+which)*7+column);
}
const sample=(sheet,feet,dt,airborne=false)=>sheet.update(feet,{speed:velocity,airborne},dim,dt);
test('同为 80 km/h，横向滑动和载荷分别控制喷雪，纯纵向推进保持轻微',()=>{
  const get=(side,weight)=>{
    const prev=footprint(0,0),dt=1/30;
    const next=footprint(dt*side,-dt*Math.sqrt(velocity**2-side**2));next.weight=weight;
    return cutResponse(next,prev,dt,velocity,dim.waistWidth);
  };
  const clean=get(.20,.82),brake=get(5,.82),light=get(5,.18);
  assertNear(brake.sideSpeed,5,1e-8);assertNear(clean.slip,.20/velocity,1e-8);
  assert.ok(brake.spray>clean.spray*7);assert.ok(brake.spray>light.spray*4);
  assertNear(get(-5,.82).spray,brake.spray,1e-10);
  assert.ok(get(0,.82).spray<.065);
  assertNear(skiLoad(1,0,1),.5,1e-8);
});

test('30、60、120 帧下板尾到旧槽连续，两板各留一条，已写入的接触点固定在世界坐标',()=>{
  for(const rate of [30,60,120]){
    const {grooves,history,live}=snowPatch(),dt=1/rate;
    const feet=z=>[footprint(-.16,z,-1),footprint(.16,z,1)];
    sample(grooves,feet(0),dt);
    assert.equal(history.drawRange.count,0);
    const z=-velocity*dt;sample(grooves,feet(z),dt);
    const count=history.drawRange.count/36,half=count/2;
    assert.equal(half,Math.ceil(velocity*dt/.22));
    for(let leg=0;leg<2;leg++){
      for(let j=0;j<half;j++){
        const at=leg*half+j,a=pointAt(history,at),b=pointAt(history,at,1);
        assertNear(a.x,leg?.16:-.16,1e-6);
        assert.ok(a.distanceTo(b)<.221);
        if(j+1<half)assertNear(b.distanceTo(pointAt(history,at+1)),0,1e-6);
      }
      const oldTail=pointAt(history,(leg+1)*half-1,1),liveTail=pointAt(live,leg*2);
      assertNear(oldTail.distanceTo(liveTail),0,1e-7);
    }
    const saved=pointAt(history,0).clone();
    sample(grooves,feet(2*z),dt);
    assertNear(saved.distanceTo(pointAt(history,0)),0,1e-8);
  }
});

test('侧滑擦面仅覆盖前刃和板尾扫过的雪，起跳或传送不在两次接触间连线',()=>{
  const {grooves,history,live}=snowPatch(),dt=1/30;
  const p=footprint(0,0);sample(grooves,[p,null],dt);
  const dx=5*dt,dz=-Math.sqrt(velocity**2-25)*dt,next=footprint(dx,dz);
  sample(grooves,[next,null],dt);
  for(const [j,f] of [[0,p],[1,next]]){
    const ends=[pointAt(history,0,j,0),pointAt(history,0,j,6)].sort((a,b)=>a.z-b.z);
    assertNear(ends[0].z,f.fore.z,1e-7);assertNear(ends[1].z,f.rear.z,1e-7);
    assertNear(ends[0].x,f.boot.x,1e-7);assertNear(ends[1].x,f.boot.x,1e-7);
  }
  const size=history.drawRange.count;
  sample(grooves,[next,null],dt,true);assert.equal(live.drawRange.count,0);
  sample(grooves,[footprint(0,-5),null],dt);
  sample(grooves,[footprint(0,-100),null],dt);
  assert.equal(history.drawRange.count,size);
  grooves.reset();assert.equal(history.drawRange.count,0);assert.equal(live.drawRange.count,0);
});
