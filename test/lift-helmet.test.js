import test from 'node:test';
import assert from 'node:assert/strict';
import {Vector3} from 'three';
import {LiftHelmet} from '../src/lift-helmet.js';
import {createRider} from '../src/rider.js';
import {colourKeys,outfitFor,riderRoles,fittingColour} from '../src/wardrobe.js';

const data={lifts:[{points:[[0,0],[600,900]]}],landmarks:[]};
const stopped={mode:'finished',speed:0,x:8,z:10,route:{destination:'genting',points:[[0,0],[8,10]]}};
const input={brake:false};
function seconds(h,n,state=stopped,keys=input,time='day'){
  for(let i=0;i<Math.round(60*n);i++)h.update(1/60,state,keys,data,time);
}

test('只在索道附近停稳后抽一次摘盔，在路上、空中、初次上站、黄昏或夜间不摘',()=>{
  for(const state of [{...stopped,speed:.02},{...stopped,mode:'summit'},{...stopped,x:230},{...stopped,airborne:true}]){
    const h=new LiftHelmet(()=>{throw Error('unexpected draw');});seconds(h,3,state);assert.equal(h.progress,0);
  }
  for(const time of ['dawn','day','noon','evening','sunset','twilight','night','aurora']){
    let calls=0;const h=new LiftHelmet(()=>{calls++;return .3;});
    seconds(h,.60,stopped,input,time);assert.equal(calls,0);
    seconds(h,5,stopped,input,time);
    assert.equal(calls,['dawn','day','noon','evening','sunset'].includes(time)?1:0);assert.equal(h.progress,calls);
  }
  let calls=0;const h=new LiftHelmet(()=>{calls++;return .9;});seconds(h,5);assert.equal(calls,1);
  h.board();h.unload();assert.equal(h.beforeDeparture(()=>{}),false);
});

test('已摘盔者上下索道、跳过乘车、立即按方向键，都只在戴好后起滑一次',()=>{
  const h=new LiftHelmet(()=>0);
  seconds(h,3);assert.equal(h.progress,1);h.board();seconds(h,3,{...stopped,mode:'lift'});assert.equal(h.progress,1);
  h.unload();let starts=0;assert.ok(h.beforeDeparture(()=>starts++));assert.ok(h.beforeDeparture(()=>starts++));
  seconds(h,.7,{...stopped,mode:'summit'},input,'night');assert.ok(h.progress>.3&&h.progress<.7);assert.equal(starts,0);
  seconds(h,1.2,{...stopped,mode:'summit'},input,'night');assert.equal(h.progress,0);assert.equal(starts,1);
  seconds(h,1.2,{...stopped,mode:'summit'});assert.equal(starts,1);
  const run={...stopped,mode:'run'};seconds(h,3,run,{brake:true});assert.equal(h.progress,1);
  assert.ok(h.update(.01,run,{boost:true},data,'day'));seconds(h,1.6,run,{boost:true});assert.equal(h.progress,0);
  seconds(h,3);h.beforeDeparture(()=>starts++);h.reset();seconds(h,2,{...stopped,mode:'summit'});assert.equal(starts,1);
});

test('四种雪服用同一组选色键，帽壳能离开发型并贴着持盔手回到头顶',()=>{
  assert.equal(new Set(riderRoles.map(role=>fittingColour(role,{}))).size,4);
  assert.equal(fittingColour('girl',{girl:colourKeys[4]}),colourKeys[4]);
  assert.equal(fittingColour('boy',{boy:'old-colour'}),fittingColour('boy',{}));
  for(const key of colourKeys)assert.equal(new Set(riderRoles.map(g=>outfitFor(g,key).coat)).size,4);
  for(const gender of riderRoles){
    const role=createRider({gender,color:colourKeys[3],gear:gender==='girl'?'board':'ski'});
    try{
      const head=role.group.getObjectByName('Helmet and goggles'),shell=role.group.getObjectByName('Detachable helmet'),hand=role.group.getObjectByName('Right glove');
      const state={mode:'finished',speed:0},origin=new Vector3();
      let tick=0;const update=p=>role.update(state,1/60,++tick/60,p);
      const pos=node=>node.getWorldPosition(new Vector3());
      update(0);assert.ok(pos(head).distanceTo(pos(shell))<1e-6);
      for(let i=1;i<=90;i++)update(i/90);
      assert.ok(pos(shell).y<pos(head).y-.12);
      assert.ok(shell.localToWorld(origin.set(.093,.148,.018)).distanceTo(pos(hand))<.004);
      if(['female','girl'].includes(gender))assert.equal(role.group.getObjectByName(gender==='girl'?'Twin braids':'Ponytail').parent,head);
      role.setVisibility('first');update(1);assert.ok(shell.visible);
      for(let i=89;i>=0;i--)update(i/90);
      assert.ok(!shell.visible);assert.ok(pos(head).distanceTo(pos(shell))<1e-6);
    } finally {role.dispose();}
  }
});
