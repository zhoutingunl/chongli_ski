// The terrain tangent under the rider is already factored out. A ski can
// bridge falling ground, but cannot cut through a convex rise.
const bounded = (x, a, b) => Math.min(b, Math.max(a, x));
const approach = (from, to, rate, dt) => from + (to - from) * -Math.expm1(-rate * dt);

export function followSkiTerrain(ski, front, middle, rear, nose, tail, dt, snap) {
  const chordAtBinding = (front * tail + rear * nose) / (nose + tail);
  const bridge = bounded((middle - chordAtBinding) / .075, 0, 1);
  // On a crest the deck stays closer to its incoming angle. Its edge still
  // seats vertically, while the unsupported shovel or tail clears the snow.
  const tipPitch = Math.atan2(front - rear, nose + tail);
  const target = bounded(tipPitch * (1 - .60 * bridge), -.24, .24);
  ski.pitchRelief = snap ? target : approach(ski.pitchRelief, target, target > ski.pitchRelief ? 22 : 13, dt);
  ski.bridge = bridge;
  return ski.pitchRelief;
}

export function seatSki(ski, contactHeight, dt, snap) {
  // Follow a raised obstacle immediately; settle small drops without a leg
  // snap. The maximum suspended gap prevents a ski hovering over a hollow.
  ski.contactY = snap ? contactHeight : Math.min(contactHeight + .036, Math.max(contactHeight,
    approach(ski.contactY, contactHeight, ski.bridge ? 17 : 29, dt)));
  return ski.contactY;
}

export function followTurn(cycle, edge, load, moving, grounded, dt, snap) {
  if (snap || !grounded || moving < .16) {
    cycle.sign = 0;
    cycle.activity = cycle.press = cycle.transfer = cycle.plant = cycle.edgeSwitch = 0;
  }
  if (!grounded || moving < .16) return cycle;

  const magnitude = Math.abs(edge);
  const nextSign = magnitude > .13 ? Math.sign(edge) : 0;
  const lastSign = cycle.sign;
  const crossing = nextSign && lastSign && nextSign !== lastSign;
  if (nextSign) cycle.sign = nextSign;

  const target = bounded(load, 0, 1) * moving;
  const releasing = bounded((cycle.activity - target) * 2.5, 0, 1);
  cycle.activity = approach(cycle.activity, target, 9, dt);
  cycle.press = approach(cycle.press, target, target > cycle.press ? 11 : 8, dt);
  cycle.edgeSwitch = crossing ? .88 : approach(cycle.edgeSwitch, 0, 9, dt);
  const transition = Math.max(releasing * (1 - magnitude), cycle.edgeSwitch);
  cycle.transfer = approach(cycle.transfer, transition, transition > cycle.transfer ? 17 : 11, dt);
  cycle.plant = approach(cycle.plant, cycle.edgeSwitch, 15, dt);
  return cycle;
}
