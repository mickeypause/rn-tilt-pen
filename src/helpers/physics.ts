import { MAX_SPEED, RADIUS, RESISTANCE } from "@/constants";

export type Vec2 = { x: number; y: number };
export type Quaternion = [number, number, number, number];
export const DEAD_ZONE = 0.015;
export type Ball = Vec2 & { vx: number; vy: number; q: Quaternion };

export function wrap(value: number, size: number) {
  "worklet";
  return ((value % size) + size) % size;
}

export function tiltAcceleration(tilt: Vec2): Vec2 {
  "worklet";
  const length = Math.hypot(tilt.x, tilt.y);
  if (!Number.isFinite(length) || length <= DEAD_ZONE) return { x: 0, y: 0 };
  const scale = (((Math.min(1, length) - DEAD_ZONE) / (1 - DEAD_ZONE)) * 2400) / length;
  return { x: tilt.x * scale, y: tilt.y * scale };
}

export function multiply(a: Quaternion, b: Quaternion): Quaternion {
  "worklet";
  return [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ];
}

// Screen x points right, y down, z toward the viewer; contact normal is -z.
export function roll(q: Quaternion, dx: number, dy: number): Quaternion {
  "worklet";
  const radius = RADIUS;
  const distance = Math.hypot(dx, dy);
  if (distance === 0) return q;
  const s = Math.sin(distance / radius / 2) / distance;
  const next = multiply([-dy * s, dx * s, 0, Math.cos(distance / radius / 2)], q);
  const norm = Math.hypot(...next);
  return [next[0] / norm, next[1] / norm, next[2] / norm, next[3] / norm];
}

export function initialBall(width: number, height: number): Ball {
  "worklet";
  return { x: width / 2, y: height / 2, vx: 0, vy: 0, q: [0, 0, 0, 1] };
}

export type MotionStep = {
  position: Vec2;
  velocity: Vec2;
  acceleration: Vec2;
  rotation: Quaternion;
  travel: Vec2;
  dt: number;
};

export function advance(ball: Ball, tilt: Vec2, seconds: number, width: number, height: number) {
  "worklet";
  const dt = Math.max(0, Math.min(seconds, 1 / 30));
  const a = tiltAcceleration(tilt);
  const steps: MotionStep[] = [];
  let next = { ...ball },
    dx = 0,
    dy = 0,
    wrapped = false;
  const ticks = Math.ceil(dt * 120);
  for (let tick = 0; tick < ticks; tick++) {
    const h = dt / ticks;
    const damping = Math.exp(-RESISTANCE * h);
    const startSpeed = Math.hypot(next.vx, next.vy);
    if (startSpeed > MAX_SPEED) {
      next.vx *= MAX_SPEED / startSpeed;
      next.vy *= MAX_SPEED / startSpeed;
    }
    let vx = next.vx * damping + (a.x * (1 - damping)) / RESISTANCE;
    let vy = next.vy * damping + (a.y * (1 - damping)) / RESISTANCE;
    const speed = Math.hypot(vx, vy);
    if (speed > MAX_SPEED) {
      vx *= MAX_SPEED / speed;
      vy *= MAX_SPEED / speed;
    }
    // Quadratic through the previous pose/tangent and the integrated endpoint.
    // Sample at <= 0.02 radius so visible curves and rolling use the identical path.
    const pieces = Math.max(
      1,
      Math.ceil((Math.max(Math.hypot(next.vx, next.vy), Math.hypot(vx, vy)) * h) / (RADIUS * 0.02)),
    );
    const v0 = { x: next.vx, y: next.vy };
    const acceleration = { x: (vx - v0.x) / h, y: (vy - v0.y) / h };
    let px = 0,
      py = 0;
    for (let i = 1; i <= pieces; i++) {
      const t = i / pieces;
      const x = h * (v0.x * t + ((vx - v0.x) * t * t) / 2);
      const y = h * (v0.y * t + ((vy - v0.y) * t * t) / 2);
      const travel = { x: x - px, y: y - py };
      const velocity = { x: v0.x + (vx - v0.x) * t, y: v0.y + (vy - v0.y) * t };
      steps.push({
        position: { x: next.x, y: next.y },
        velocity,
        acceleration,
        rotation: next.q,
        travel,
        dt: h / pieces,
      });
      const rawX = next.x + travel.x,
        rawY = next.y + travel.y;
      wrapped ||= rawX < 0 || rawX >= width || rawY < 0 || rawY >= height;
      next = {
        x: wrap(rawX, width),
        y: wrap(rawY, height),
        vx: velocity.x,
        vy: velocity.y,
        q: roll(next.q, travel.x, travel.y),
      };
      dx += travel.x;
      dy += travel.y;
      px = x;
      py = y;
    }
  }
  return { ball: next, dx, dy, wrapped, steps };
}
