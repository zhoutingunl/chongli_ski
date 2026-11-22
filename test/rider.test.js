import assert from 'node:assert/strict';
import test from 'node:test';
import {Vector3} from 'three';
import {createRider, getRiderDimensions} from '../src/rider.js';

test('儿童双板和单板有独立的长度比例，只有双板配雪杖', () => {
  for (const gear of ['ski', 'board']) {
    const adult = getRiderDimensions({gender: 'male', gear});
    for (const gender of ['boy', 'girl']) {
      const child = getRiderDimensions({gender, gear});
      assert.equal(child.isChild, true);
      assert.ok(child.deckLength < adult.deckLength * child.scale);
      assert.ok(child.stanceWidth > 0 && child.stanceWidth < adult.stanceWidth);
      if (gear === 'ski') assert.ok(child.poleLength > 0 && child.poleLength < adult.poleLength);
      else assert.equal(child.poleLength, 0);
    }
  }
});

const slope = 12;
const radians = slope * Math.PI / 180;
const snow = {height: (x, z) => Math.tan(radians) * z};

// Let the chase-camera model settle on a 12° piste. Measure its visible
// clothing in piste coordinates, and pole tips against the snow below them.
function samplePose(rider, speed, edge, startTime, overrides={}) {
  rider.group.position.set(0, 0.004, 0);
  rider.group.rotation.x = -radians;
  const state = {mode: 'run', data: snow, x: 0, z: 0, slope, heading: 0, travelHeading: 0,
    speed, edge, steer: edge, curve: edge * 0.68, pressure: Math.abs(edge), ...overrides};
  for (let frame = 1; frame <= 90; frame++) {
    state.elapsed = startTime + frame / 90;
    rider.update(state, 1 / 90, state.elapsed);
  }
  const position = (name, point = new Vector3()) =>
    rider.group.worldToLocal(rider.group.getObjectByName(name).localToWorld(point));
  const head = position('Helmet and goggles', new Vector3(0, 0.165, 0));
  const hip = position('Snow pants');
  const sides = ['Left', 'Right'];
  const ankles = sides.map(side => position(side + ' boot and binding', new Vector3(0, 0.092, -0.01)));
  const hands = sides.map(side => position(side + ' glove'));
  const poles = sides.map(side => {
    const pole = rider.group.getObjectByName(side + ' pole');
    const grip = pole.getWorldPosition(new Vector3());
    const tip = pole.localToWorld(new Vector3(0, -rider.dimensions.poleLength / rider.dimensions.scale, 0));
    const clearance = tip.y - snow.height(tip.x, tip.z);
    const trailing = rider.group.worldToLocal(tip).z - rider.group.worldToLocal(grip).z;
    return {clearance, trailing};
  });
  return {head, hip, ankles, hands, poles};
}

for (const [gender, label] of [['boy', '男孩'], ['girl', '女孩']]) {
  test(label + '直滑时双手在胯旁，提速后降低姿态、加大前倾并向后提杖', t => {
    const rider = createRider({gender, gear: 'ski'});
    t.after(() => rider.dispose());
    const slow = samplePose(rider, 3, 0, 0);
    const fast = samplePose(rider, 24, 0, 1);
    assert.ok(slow.hands.every(hand => Math.abs(hand.y - slow.hip.y) < .06));
    assert.ok(fast.hands.every(hand => hand.z < fast.hip.z - .12));
    assert.ok(fast.hip.y < slow.hip.y - 0.07);
    const lean = pose => Math.atan2(pose.hip.z - pose.head.z, pose.head.y - pose.hip.y);
    assert.ok(lean(fast) > lean(slow) + 15 * Math.PI / 180);
    for (const pole of fast.poles) assert.ok(pole.clearance > 0.12 && pole.trailing > 0.4);
  });

  test(label + '换刃后身体随弯倾斜，内腿收回，内外手交换高低', t => {
    const rider = createRider({gender, gear: 'ski'});
    t.after(() => rider.dispose());
    for (const [time, edge, inside] of [[0, -0.73, 0], [1, 0.73, 1]]) {
      const pose = samplePose(rider, 16, edge, time);
      const outside = 1 - inside;
      assert.ok((pose.head.x - pose.hip.x) * Math.sign(edge) > 0.07);
      assert.ok(pose.hip.distanceTo(pose.ankles[inside]) < pose.hip.distanceTo(pose.ankles[outside]));
      assert.ok(pose.hands[outside].y - pose.hands[inside].y > 0.08);
    }
  });
}

test('成人和儿童在不对称雪面上分别调整两块雪板和膝盖', t => {
  const uneven={height:(x,z)=>0.12*z +
    (x<0 ? .075*Math.max(0,1-2*Math.abs(z+.3)) : -.040*Math.max(0,1-2*Math.abs(z-.17)))};
  for(const gender of ['male','girl']){
    const rider=createRider({gender,gear:'ski'});
    t.after(()=>rider.dispose());
    rider.group.position.set(0,.004+uneven.height(0,0),0);
    const state={mode:'run',data:uneven,x:0,z:0,heading:0,travelHeading:0,speed:5,slope:Math.atan(.12)*180/Math.PI};
    rider.group.rotation.x=-Math.atan(.12);
    for(let i=0;i<90;i++)rider.update(state,1/90,i/90);
    const left=rider.group.getObjectByName('Left ski'), right=rider.group.getObjectByName('Right ski');
    assert.ok(left.position.y>right.position.y+.02);
    assert.ok(Math.abs(left.rotation.x-right.rotation.x)>.005);
    const joints=['Left trouser leg lower joint','Right trouser leg lower joint'].map(name=>rider.group.getObjectByName(name).getWorldPosition(new Vector3()));
    assert.ok(Math.abs(joints[0].y-joints[1].y)>.004);
  }
});

test('成人和儿童双板极速滑行时降低重心、收杖，刹车时回升并把一侧杖尖降到雪边', t => {
  for(const gender of ['male','girl']){
    const rider=createRider({gender,gear:'ski'});
    t.after(()=>rider.dispose());
    const fast=samplePose(rider,30,0,0), brake=samplePose(rider,30,0,1,{brake:1,skid:.25});
    const lean=pose=>Math.atan2(pose.hip.z-pose.head.z,pose.head.y-pose.hip.y);
    assert.ok(lean(fast)>lean(brake)+14*Math.PI/180);
    assert.ok(fast.hip.y<brake.hip.y-.04);
    for(const pole of fast.poles)assert.ok(pole.clearance>.25&&pole.trailing>.57);
    const contact=Math.min(...brake.poles.map(pole=>pole.clearance));
    assert.ok(contact>-.015&&contact<.11);
  }
});
