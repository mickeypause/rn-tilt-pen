import { DEFAULT_BRUSH, MAX_SPEED, RADIUS } from "@/constants";
import { roll, wrap, type Quaternion, type Vec2 } from "@/helpers/physics";

export type BrushSettings = { minWidth: number; maxWidth: number; splatter: number };
export type BrushState = {
  width: number;
  arc: number;
  remaining: number;
  seed: number;
  acceleration: Vec2;
  cooldown: number;
  moving: boolean;
};
export type InkCommand = Vec2 & {
  id: number;
  q: Quaternion;
  uv: [number, number];
  radius: number;
  aspect: number;
  angle: number;
  kind: 0 | 1;
  grain: number;
};
export type BrushInput = {
  position: Vec2;
  velocity: Vec2;
  acceleration: Vec2;
  contactUV: [number, number];
  rotation: Quaternion;
  travel: Vec2;
  dt: number;
  page: Vec2;
};

export function initialBrush(seed = 19790117): BrushState {
  "worklet";
  return {
    width: RADIUS * 2 * DEFAULT_BRUSH.maxWidth,
    arc: 0,
    remaining: 0,
    seed: seed >>> 0,
    acceleration: { x: 0, y: 0 },
    cooldown: 0,
    moving: false,
  };
}

export function random(state: BrushState) {
  "worklet";
  state.seed = (Math.imul(1664525, state.seed) + 1013904223) >>> 0;
  return state.seed / 4294967296;
}

export function contactUV(q: Quaternion): [number, number] {
  "worklet";
  const x = 2 * (q[1] * q[3] - q[0] * q[2]);
  const y = -2 * (q[1] * q[2] + q[0] * q[3]);
  const z = 2 * (q[0] * q[0] + q[1] * q[1]) - 1;
  return [
    wrap(Math.atan2(z, x) / (2 * Math.PI) + 0.5, 1),
    Math.asin(Math.max(-1, Math.min(1, y))) / Math.PI + 0.5,
  ];
}

export function widthForSpeed(speed: number, settings: BrushSettings): number {
  "worklet";
  const t = Math.max(0, Math.min(1, speed / (MAX_SPEED * 0.8)));
  const smooth = t * t * (3 - 2 * t);
  return (
    RADIUS *
    2 *
    (settings.maxWidth + (Math.max(0.07, settings.minWidth) - settings.maxWidth) * smooth)
  );
}

export function splatterStrength(speed: number, normalAcceleration: number, jerk: number): number {
  "worklet";
  if (speed < 140) return 0;
  return Math.max(
    (speed * normalAcceleration) / 55000,
    speed > 220 ? ((jerk / 10000) * speed) / 300 : 0,
  );
}

export function brushStep(
  previous: BrushState,
  input: BrushInput,
  settings: BrushSettings,
  firstId: number,
) {
  "worklet";
  const state: BrushState = { ...previous, acceleration: input.acceleration };
  const commands: InkCommand[] = [];
  const speed = Math.hypot(input.velocity.x, input.velocity.y);
  const distance = Math.hypot(input.travel.x, input.travel.y);
  const dt = Math.max(0, Math.min(input.dt, 1 / 30));
  const target = widthForSpeed(speed, settings);
  state.width += (target - state.width) * (1 - Math.exp(-dt / 0.12));
  state.cooldown = Math.max(0, state.cooldown - dt);
  if (distance < 0.01 || speed < 0.75) {
    state.moving = false;
    return { state, commands, splatter: false, bigSplatter: false };
  }

  let at = state.moving ? state.remaining : 0;
  while (at <= distance) {
    const t = at / distance;
    const arc = state.arc + at;
    const wobble = 1 + 0.045 * Math.sin(arc * 0.11) + 0.025 * Math.sin(arc * 0.37 + 1.7);
    const diameter = Math.max(
      RADIUS * 2 * 0.07,
      (previous.width + (state.width - previous.width) * t) * wobble,
    );
    const q = roll(input.rotation, input.travel.x * t, input.travel.y * t);
    commands.push({
      id: firstId + commands.length + 1,
      x: wrap(input.position.x + input.travel.x * t, input.page.x),
      y: wrap(input.position.y + input.travel.y * t, input.page.y),
      q,
      uv: contactUV(q),
      radius: diameter / 2,
      aspect: 1,
      angle: 0,
      kind: 0,
      grain: 0,
    });
    at += diameter * 0.18;
  }
  state.remaining = at - distance;
  state.arc += distance;
  state.moving = true;

  const cross = input.velocity.x * input.acceleration.y - input.velocity.y * input.acceleration.x;
  const normalAcceleration = Math.abs(cross) / Math.max(speed, 1);
  const jerk =
    Math.hypot(
      input.acceleration.x - previous.acceleration.x,
      input.acceleration.y - previous.acceleration.y,
    ) / dt;
  const strength = splatterStrength(speed, normalAcceleration, jerk);
  const emit = strength > 1 && state.cooldown === 0 && settings.splatter > 0;
  if (emit) {
    const tx = input.velocity.x / speed,
      ty = input.velocity.y / speed;
    const outside = cross >= 0 ? -1 : 1;
    const nx = -ty * outside,
      ny = tx * outside;
    const count = Math.min(18, Math.round((6 + random(state) * 6) * settings.splatter));
    const q = roll(input.rotation, input.travel.x, input.travel.y);
    for (let i = 0; i < count; i++) {
      const forward = 0.25 + random(state) * 0.9;
      const outward = normalAcceleration > 80 ? 0.4 + random(state) : (random(state) - 0.5) * 0.6;
      const norm = Math.hypot(forward, outward);
      const reach = RADIUS * (0.25 + Math.pow(random(state), 0.65) * 3.55);
      const elongated = random(state) < 0.25;
      commands.push({
        id: firstId + commands.length + 1,
        x: wrap(
          input.position.x + input.travel.x + ((tx * forward + nx * outward) / norm) * reach,
          input.page.x,
        ),
        y: wrap(
          input.position.y + input.travel.y + ((ty * forward + ny * outward) / norm) * reach,
          input.page.y,
        ),
        q,
        uv: input.contactUV,
        radius: 0.5 + Math.pow(random(state), 2) * 5,
        aspect: elongated ? 1.5 + random(state) * 1.6 : 1,
        angle: Math.atan2(ty, tx) + (random(state) - 0.5) * 0.65,
        kind: 1,
        grain: random(state) * 1000,
      });
    }
    state.cooldown = 0.32;
  }
  return {
    state,
    commands,
    splatter: emit,
    bigSplatter: emit && commands.filter((command) => command.kind === 1).length >= 8,
  };
}
