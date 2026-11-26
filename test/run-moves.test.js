import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {Vector3} from 'three';
import {prepareMountain} from '../src/mountain.js';
import {Descent,physicsStep} from '../src/simulation.js';
import {DescentFrames} from '../src/descent-frames.js';
import {roomToPop} from '../src/run-moves.js';
import {createRider} from '../src/rider.js';

function practice(gear='ski',random=()=>0){
  const data=prepareMountain({
    bounds:{minX:-100,maxX:100,minZ:-1600,maxZ:80},
    dem:{cols:2,rows:2,heights:[1260,1260,1512,1512]},
    trails:[{id:'slope',width:42,points:[[0,0],[0,-1500]]}],buildings:[],
    routes:[{id:'descent',points:[[0,0],[0,-1500]]}]
  });
  const sim=new Descent(data,{gear,assist:true,variedMoves:true},null,random);
  sim.start(data.routes[0]);sim.speed=13;
  return sim;
}

test('长弯和短弯改变真实轨迹，雪道中途手动转弯、加速、刹车或蓄力立即接管',()=>{
  const wide=practice(),quick=practice('ski',()=>.45);
  const lanes=[];
  for(let n=0;n<810;n++){
    wide.tick(physicsStep);quick.tick(physicsStep);
    if(n>610)lanes.push(Math.abs(wide.offset-quick.offset));
  }
  assert.ok(wide.moves.carve>.95 && quick.moves.shortTurns>.95);
  assert.ok(wide.automatic.amplitude>quick.automatic.amplitude*1.8);
  assert.ok(wide.automatic.radius>quick.automatic.radius*1.35);
  assert.ok(Math.max(...lanes)>2.5);
  for(const control of [{steer:1},{trim:-1},{boost:true},{brake:true},{jump:true}]){
    const sim=practice();sim.tick(6);
    assert.ok(sim.moves.carve>.95);
    if(control.jump)sim.beginJump();
    sim.tick(physicsStep,control);
    assert.equal(sim.moves.kind,null);
    sim.tick(.25,control);
    assert.ok(sim.moves.carve<.02);
    if(control.jump){assert.ok(sim.releaseJump());assert.equal(sim.moves.didPop,false);}
  }
});

test('关闭动作、极速直冲、道口、狭道、道外、上坡和山脚接驳都不发起动作',()=>{
  for(const change of [
    s=>{s.opts.variedMoves=false;},s=>{s.opts.assist=false;},s=>{s.speed=28;},
    s=>{s.activeJunction=()=>({along:s.along+12});},s=>{s.pisteContact.trail.width=16;},
    s=>{s.data.index.near=()=>({distance:45,trail:null});s.surface();},
    s=>{s.data.height=(_,z)=>1500-.14*z;},s=>{s.route.finishKind='lift-link';},
    s=>{s.requestedTurn={id:'upcoming'};},s=>{s.route.length=40;},
    s=>{s.data.lifts=[{points:[[5,3],[500,500]]}];}
  ]){
    const s=practice();s.automatic.idle=3;s.moves.gear=s.gear;s.moves.wait=0;
    change(s);s.tick(physicsStep);
    assert.equal(s.moves.kind,null);
  }
  const s=practice();s.tick(6);s.opts.variedMoves=false;s.tick(.4);
  assert.equal(s.moves.kind,null);assert.ok(s.moves.carve<.001);
  s.start(s.route);assert.equal(s.moves.carve,0);
});

function rollingPiste(gear){
  const s=practice(gear);
  s.data.height=(_,z)=>1500+.17*z-.0027*z*z;
  s.automatic.idle=3;s.moves.gear=gear;s.moves.popCooldown=0;
  return s;
}

test('只在凸坡前准备小跳，检查真实落点，遭遇障碍或被玩家接管会收回准备动作',()=>{
  assert.equal(roomToPop(practice()),false);
  for(const reason of ['tree','edge','brake','manual']){
    const s=rollingPiste('board');assert.ok(roomToPop(s,.38));s.tick(.20);
    assert.equal(s.moves.kind,'pop');assert.ok(s.moves.preload>.25);
    if(reason==='tree')s.data.obstacles={contact:()=>({kind:'tree'})};
    if(reason==='edge'){
      const near=s.data.index.near.bind(s.data.index);
      s.data.index.near=(x,z)=>z < -7?{trail:null,distance:100}:near(x,z);
    }
    if(reason==='manual')s.beginJump();
    s.tick(.24,reason==='brake'?{brake:true}:{});
    assert.equal(s.airborne,false);assert.equal(s.moves.kind,null);
    if(reason==='manual')assert.ok(s.releaseJump());
  }
});

for(const gear of ['ski','board'])test(gear+' 的小跳跟随重力抛物线，在落地前收回空中动作，只记录一次落地',()=>{
  const s=rollingPiste(gear);
  let peak=0,apex=0,last=0;
  for(let i=0;i<125;i++){
    const flying=s.airborne;s.tick(physicsStep);
    if(flying&&!s.airborne)break;
    if(s.airborne){peak=Math.max(peak,s.airHeight);apex=Math.max(apex,s.moves.airPose);last=s.moves.airPose;}
  }
  assert.ok(peak>.18 && peak<.95);assert.ok(apex>.75 && last<.12);
  assert.equal(s.feedback.landing,1);assert.equal(s.y,s.ground);assert.equal(s.moves.airPose,0);
});

test('手动蓄力跳可做空中收板，短按正常起落，两者均保留玩家给定的起跳力度',()=>{
  for(const hold of [.09,.60]){
    const styled=practice('board'),plain=practice('board');
    styled.opts.assist=plain.opts.assist=false;plain.opts.variedMoves=false;
    for(const run of [styled,plain]){run.beginJump();run.tick(hold);assert.ok(run.releaseJump());}
    let peak=0;
    while(styled.airborne){
      styled.tick(physicsStep);plain.tick(physicsStep);peak=Math.max(peak,styled.moves.airPose);
      assert.equal(styled.airHeight,plain.airHeight);assert.equal(styled.speed,plain.speed);
      assert.equal(plain.moves.airPose,0);
    }
    if(hold<.1)assert.equal(peak,0);else assert.ok(peak>.9);
    assert.equal(styled.moves.manualAir,false);
  }
});

test('相同随机种子在不同画面帧率下给出同一组动作和线路，重绘不抽签',()=>{
  function ride(hz){
    let seed=46,calls=0;
    const sim=practice('board',()=>{calls++;seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/2**32;});
    const frames=new DescentFrames(sim),picks=[];
    let prev=null;
    for(let i=0;i<hz*46;i++){
      frames.advance(1/hz,{});
      const kind=sim.moves.kind;
      if(kind && kind!==prev)picks.push(kind);prev=kind;
      const count=calls;
      frames.renderPose();frames.renderPose();assert.equal(calls,count);
    }
    return {picks,calls,along:sim.along};
  }
  const a=ride(30),b=ride(60);
  assert.ok(a.picks.length>=4 && a.picks.every((k,i)=>!i||k!==a.picks[i-1]));
  assert.deepEqual(a.picks,b.picks);assert.equal(a.calls,b.calls);assert.ok(Math.abs(a.along-b.along)<.23);
});

function settled(rider,edge,kind,start,overrides={}){
  const state={mode:'run',x:0,z:0,heading:0,travelHeading:0,slope:0,data:{height:()=>0},
    speed:13,edge,curve:edge*.7,pressure:Math.abs(edge),automatic:{phase:1},moves:{[kind]:1},...overrides};
  for(let i=0;i<70;i++){state.elapsed=start+i/90;rider.update(state,physicsStep,state.elapsed);}
  return name=>rider.group.worldToLocal(rider.group.getObjectByName(name).getWorldPosition(new Vector3()));
}

test('成人和儿童单板刻滑时内手贴近雪面、外手抬起，压板尾时板头与前脚一起抬升',t=>{
  for(const gender of ['male','girl']){
    const rider=createRider({gender,gear:'board'});t.after(()=>rider.dispose());
    let time=0;
    for(const edge of [-.68,.68]){
      const hand=edge<0?'Left glove':'Right glove',other=edge>0?'Left glove':'Right glove';
      const base=settled(rider,edge,'none',time++),ordinary=base(hand).y;
      const carve=settled(rider,edge,'carve',time++);
      assert.ok(carve(hand).y<.14 && carve(hand).y<ordinary-.16);
      assert.ok(carve(other).y>carve(hand).y+.33);
    }
    const normal=settled(rider,.35,'none',time++),low=normal('Left boot').y;
    const press=settled(rider,.35,'balance',time++);
    assert.ok(rider.group.getObjectByName('Snowboard').rotation.x>.18);
    assert.ok(press('Left boot').y>low+.065);
  }
});

test('双板提步时只抬内板，换刃后提起另一侧，外板仍然贴雪',t=>{
  for(const gender of ['female','boy']){
    const rider=createRider({gender,gear:'ski'});t.after(()=>rider.dispose());
    for(const [i,edge] of [-.68,.68].entries()){
      const inner=edge<0?'Left ski':'Right ski',outer=edge>0?'Left ski':'Right ski';
      const n=settled(rider,edge,'none',i*2),onSnow=n(outer).y,rest=n(inner).y;
      const p=settled(rider,edge,'balance',i*2+1);
      assert.ok(p(inner).y>rest+.084);assert.ok(Math.abs(p(outer).y-onSnow)<.014);
    }
  }
});

test('双板短弯换刃时交替点杖，进入高速区后两支雪杖留在身后',t=>{
  const rider=createRider({gender:'male',gear:'ski'});t.after(()=>rider.dispose());
  const tips=()=>['Left pole','Right pole'].map(name=>{
    const pole=rider.group.getObjectByName(name);
    return pole.localToWorld(new Vector3(0,-rider.dimensions.poleLength/rider.dimensions.scale,0));
  });
  for(const [i,phase] of [Math.PI,0].entries()){
    settled(rider,0,'shortTurns',i,{automatic:{phase}});
    const positions=tips();assert.ok(Math.abs(positions[i].y)<.055);
    assert.ok(positions[1-i].y>positions[i].y+.12);
  }
  settled(rider,0,'shortTurns',2,{speed:27,automatic:{phase:0}});
  assert.ok(tips().every(tip=>tip.y>.14 && tip.z>.23));
});

test('万龙金龙道和云顶实测路线都能自然触发不同动作，完整金龙道仍可抵达山脚',()=>{
  const data=prepareMountain(JSON.parse(readFileSync(new URL('../public/assets/geo/mountain.json',import.meta.url))));
  for(const [id,gear] of [['wanlong-gold','board'],['genting-classic','ski']]){
    let seed=2026;
    const sim=new Descent(data,{gear,assist:true,variedMoves:true},null,()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/2**32));
    sim.start(data.allRoutes.find(route=>route.id===id));sim.speed=2.15;
    const seen=new Set();let launched=false;
    for(let i=0;i<90*160&&sim.mode==='run';i++){
      sim.tick(physicsStep);
      if(sim.moves.kind)seen.add(sim.moves.kind);
      if(sim.moves.didPop && sim.airborne)launched=true;
    }
    assert.deepEqual([...seen].sort(),['balance','carve','pop','shortTurns']);assert.ok(launched);
    if(id==='wanlong-gold')assert.equal(sim.mode,'finished');
  }
});
