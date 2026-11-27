import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {Matrix4,Scene,Vector3} from 'three';
import {prepareMountain,randomGenerator} from '../src/mountain.js';
import {Descent,physicsStep as dt} from '../src/simulation.js';
import {PisteTraffic,passingDistance,daylightTraffic,passengerManifest,collisionPose} from '../src/piste-traffic.js';
import {createPisteGuests} from '../src/piste-guests.js';
import {createLift} from '../src/resort.js';
import {createRider} from '../src/rider.js';
import {colourKeys,riderRoles,outfitFor} from '../src/wardrobe.js';

function setup(assist,gear='ski',seed=23){
  const data=prepareMountain({bounds:{minX:-100,minZ:-1200,maxX:100,maxZ:100},
    dem:{cols:2,rows:2,heights:[1300,1300,1560,1560]},buildings:[],
    trails:[{id:'main',width:40,points:[[0,0],[0,-1000]]}],
    routes:[{id:'practice',points:[[0,0],[0,-1000]]}]});
  const sim=new Descent(data,{assist,gear},null,randomGenerator(8));
  sim.traffic=new PisteTraffic(data,randomGenerator(seed));sim.start(data.routes[0]);
  return sim;
}

function encounter(assist,gear='ski',along=29,moving=false){
  const sim=setup(assist,gear),t=sim.traffic;t.route=sim.route;t.patrol=100;
  const guest=t.make(sim.route,along,0,!moving);
  if(moving){guest.amplitude=0;guest.pace=5;t.place(guest,0);}
  guest.opacity=1;t.actors=[guest];sim.speed=17;
  return {sim,t,guest};
}
test('白天持续有滑行者与同坐聊天的单板双人组，夜晚渐疏，两次出发的分布不同',()=>{
  const sim=setup(true),t=sim.traffic;
  t.advance(.1,sim);
  const chat=t.actors.filter(a=>a.seated),moving=t.actors.filter(a=>!a.seated);
  assert.equal(moving.length,7);assert.equal(chat.length,2);
  assert.ok(moving.some(a=>a.gear==='ski')&&moving.some(a=>a.gear==='board'));
  assert.ok(chat.every(a=>a.gear==='board'&&a.pace===0));
  const separation=Math.hypot(chat[0].x-chat[1].x,chat[0].z-chat[1].z);
  assert.ok(separation>1.5&&separation<3);
  assert.ok(Math.abs(chat[0].heading-chat[1].heading)>2);
  const starts=t.actors.map(a=>a.along),prev=t.actors.map(a=>a.x);
  for(let i=0;i<180;i++)t.advance(dt,sim);
  for(const a of moving){assert.ok(a.along>starts[a.id-1]+6);assert.notEqual(a.x,prev[a.id-1]);}
  for(const a of chat)assert.equal(a.along,starts[a.id-1]);
  const departing=moving[0],lastAlong=departing.along;
  sim.start(sim.route,true);sim.tick(dt);
  assert.equal(t.actors[0],departing);assert.ok(departing.along>lastAlong);
  t.night=1;
  for(let i=0;i<750;i++)t.advance(dt,sim);
  assert.equal(t.actors.filter(a=>!a.seated).length,2);assert.equal(t.actors.some(a=>a.seated),false);
  t.night=0;sim.start(sim.route);t.advance(.1,sim);assert.notDeepEqual(t.actors.map(a=>a.along),starts);
});
test('穿过相邻帧中间的雪友也能检测到，错层或道外不触发碰撞',()=>{
  const other={prevX:0,prevZ:-1,x:0,z:1};
  assert.ok(passingDistance(-2,0,2,0,other)<.001);
  assert.ok(passingDistance(-2,4,2,4,other)>2);
  const {t,sim,guest}=encounter(false,'board',2);
  Object.assign(sim,{x:guest.x,z:guest.z,airHeight:1.5});
  assert.equal(t.contact(sim,sim.x+2,sim.z,.05,true),null);
  sim.airHeight=0;sim.onTrail=false;
  assert.equal(t.contact(sim,sim.x+2,sim.z,.05,true),null);
  sim.onTrail=true;assert.equal(t.contact(sim,sim.x+2,sim.z,.05,false),null);
});
for(const gear of ['ski','board']){
  test(gear+' 循线滑行实际留出会车空间，持续加速也能绕开坐着或移动的雪友',()=>{
    for(const moving of [false,true])for(const held of [false,true]){
      const {sim,guest}=encounter(true,gear,34,moving);
      let nearest=Infinity,beside=0,passes=0;
      for(let i=0;i<500;i++){
        sim.tick(dt,{boost:held});
        nearest=Math.min(nearest,Math.hypot(guest.x-sim.x,guest.z-sim.z));
        if(Math.abs(guest.along-sim.along)<1.1)beside=Math.max(beside,Math.abs(sim.x-guest.x));
        if(sim.traffic.pass)passes++;
      }
      assert.ok(passes>15&&sim.along>guest.along+3);
      assert.ok(nearest>1.45&&beside>1.45,JSON.stringify({gear,moving,held,nearest,beside}));
      assert.equal(sim.feedback.skier,0);
    }
  });
  test(gear+' 手动高速撞人会掉板，手靠近固定器后复位，双方恢复且碰撞不连发',()=>{
    const {sim,t,guest}=encounter(false,gear,8);
    const rider=createRider({gear,gender:'female',color:colourKeys[5]});
    const step=(count)=>{for(let i=0;i<count;i++){sim.tick(dt);rider.update(sim,dt,sim.elapsed);}};
    for(let i=0;i<120&&!t.playerHit;i++)step(1);
    assert.equal(t.playerHit?.released,true);assert.equal(guest.reaction.released,true);
    const deck=rider.group.getObjectByName(gear==='board'?'Snowboard':t.playerHit.side<0?'Left ski':'Right ski');
    const boot=deck.children.find(p=>p.name.toLowerCase().includes('boot'));
    const mesh=deck.children.find(p=>p.isMesh),hand=rider.group.getObjectByName('Right glove');
    const start=sim.travel,standing=hand.getWorldPosition(new Vector3());
    step(106);
    assert.equal(sim.beginJump(),false);assert.equal(sim.speed,0);assert.equal(sim.travel,start);
    assert.ok(Math.abs(mesh.position.x)>.65);assert.ok(Math.abs(boot.position.x)<.08);
    assert.ok(hand.getWorldPosition(new Vector3()).y<standing.y-.11);
    assert.ok(collisionPose(t.playerHit.age,true).reach>.95);
    step(320);
    assert.equal(t.playerHit,null);assert.equal(guest.reaction,null);assert.equal(sim.feedback.skier,1);
    assert.ok(mesh.position.length()<.0001&&Math.abs(mesh.rotation.y)<.001);assert.ok(sim.travel>start);
    rider.dispose();
  });
}
test('轻碰只减速并有短暂反应，手动转向可以直接接管',()=>{
  const {sim,t,guest}=encounter(true,'ski',2);sim.speed=5;
  for(let i=0;i<100&&!t.playerHit;i++)sim.tick(dt,{steer:.23});
  assert.equal(sim.feedback.skier,1);assert.equal(t.playerHit.released,false);assert.ok(guest.reaction);
  assert.ok(sim.speed>0&&sim.speed<4);sim.tick(.8);assert.equal(t.playerHit,null);
});
test('两座雪场实景人物与缆车座位按时段可见，座位随车保持不变',()=>{
  const rng=randomGenerator(61),seats=Array.from({length:30},()=>passengerManifest(rng,4)).flat();
  const occupied=(night)=>seats.filter(p=>p.ticket<daylightTraffic(night).seatChance);
  assert.ok(occupied(0).length>occupied(1).length*2);assert.deepEqual(occupied(.5),occupied(.5));
  for(const resort of ['wanlong','genting']){
    const sim=setup(true);sim.traffic.advance(1,sim);
    const view=createPisteGuests(new Scene(),sim.data);view.draw(sim.traffic.actors,new Vector3(0,1500,0));
    assert.ok(view.group.getObjectByName('Snowboards').count>=2);
    assert.ok(view.group.getObjectByName('Articulated sleeves and trousers').count>40);
    const lift=createLift({id:'sample',resort,random:randomGenerator(37),kind:resort==='genting'?'gondola':'chair',points:[new Vector3(0,0,0),new Vector3(0,30,-200)]});
    const eye=lift.seatAt(.4,1);
    function capture(night){
      lift.update(23,eye,.4,1,night);
      return lift.group.children.filter(m=>m.name==='Seated lift guests').flatMap(m=>Array.from({length:m.count},(_,i)=>{
        const mat=new Matrix4();m.getMatrixAt(i,mat);return mat.elements.map(v=>v.toFixed(3)).join(',');
      }));
    }
    const day=capture(0),night=capture(1);
    assert.deepEqual(day,capture(0));assert.ok(day.length>0);assert.deepEqual(night,day,'已在途的乘客在亮暗切换时继续坐在原位');
  }
});
test('同趟多人交汇时，金龙、长龙及云顶实测路线自动超越留出一人宽度',()=>{
  const data=prepareMountain(JSON.parse(readFileSync(new URL('../public/assets/geo/mountain.json',import.meta.url),'utf8')));
  for(const [id,seed] of [['wanlong-gold',2],['wanlong-classic',3],['genting-classic',4]]){
    const sim=new Descent(data,{assist:true,gear:seed%2?'ski':'board',variedMoves:true},null,randomGenerator(31));
    sim.traffic=new PisteTraffic(data,randomGenerator(seed));
    sim.start(sim.navigation.safeRun(data.allRoutes.find(r=>r.id===id)));
    let near=0,closest=Infinity;
    for(let i=0;i<90*150&&sim.mode==='run';i++){
      sim.tick(dt);
      for(const a of sim.traffic.actors){
        if(a.opacity<.7||sim.airHeight>.9)continue;
        const distance=Math.hypot(a.x-sim.x,a.z-sim.z);
        if(distance<8)near++;
        closest=Math.min(closest,distance);
      }
    }
    assert.ok(near>35&&closest>1.3,JSON.stringify({id,seed,near,closest}));
    assert.equal(sim.feedback.skier,0);
  }
});
test('每位角色六套互异配色并保留已有五个存档键',()=>{
  assert.equal(colourKeys.length,6);assert.deepEqual(colourKeys.slice(0,5),['#aa5536','#ba9041','#597b78','#476d91','#c5c3b6']);
  for(const role of riderRoles)assert.equal(new Set(colourKeys.map(key=>outfitFor(role,key).coat)).size,6);
});
