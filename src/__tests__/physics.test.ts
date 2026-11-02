import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_SPEED, RADIUS, RESISTANCE } from "@/constants";
import { advance, initialBall, multiply, roll, tiltAcceleration, wrap } from "@/helpers/physics";

const near = (a: number, b: number, epsilon = 1e-8) =>
  assert.ok(Math.abs(a - b) < epsilon, `${a} != ${b}`);
test("tilt dead zone, direction, saturation and invalid input", () => {
  assert.deepEqual(tiltAcceleration({ x: 0.01, y: -0.01 }), { x: 0, y: 0 });
  near(tiltAcceleration({ x: 1, y: 0 }).x, 2400);
  near(Math.hypot(...Object.values(tiltAcceleration({ x: 2, y: 2 }))), 2400);
  assert.ok(tiltAcceleration({ x: -0.4, y: 0.5 }).x < 0);
  assert.deepEqual(tiltAcceleration({ x: NaN, y: 0 }), { x: 0, y: 0 });
});
test("friction is independent of refresh rate and never reverses velocity", () => {
  const b = { ...initialBall(400, 800), vx: 100 };
  let sixty = b,
    oneTwenty = b;
  for (let i = 0; i < 60; i++) sixty = advance(sixty, { x: 0, y: 0 }, 1 / 60, 400, 800).ball;
  for (let i = 0; i < 120; i++)
    oneTwenty = advance(oneTwenty, { x: 0, y: 0 }, 1 / 120, 400, 800).ball;
  near(sixty.vx, 100 * Math.exp(-RESISTANCE));
  near(sixty.vx, oneTwenty.vx);
});
test("speed is capped and suspension delta clamped", () => {
  let b = initialBall(400, 800);
  for (let i = 0; i < 600; i++) b = advance(b, { x: 1, y: 1 }, 1 / 60, 400, 800).ball;
  near(Math.hypot(b.vx, b.vy), MAX_SPEED);
  assert.ok(advance(b, { x: 1, y: 1 }, 20, 400, 800).dx <= MAX_SPEED / 30);
});
test("wrap works in every direction", () => {
  assert.equal(wrap(-2, 100), 98);
  assert.equal(wrap(302, 100), 2);
  assert.equal(wrap(-302, 100), 98);
  assert.equal(wrap(100, 100), 0);
});
test("rolling without slip: one radius is one radian, full circumference is a turn", () => {
  const q = roll([0, 0, 0, 1], RADIUS, 0);
  near(q[1], Math.sin(0.5));
  near(q[3], Math.cos(0.5));
  near(Math.abs(roll([0, 0, 0, 1], 2 * Math.PI * RADIUS, 0)[3]), 1);
});
test("diagonals rotate around the combined axis; turns compose in world order", () => {
  const q = roll([0, 0, 0, 1], 30, 40);
  near(q[0] / q[1], -4 / 3);
  const x = roll([0, 0, 0, 1], 30, 0),
    y = roll([0, 0, 0, 1], 0, 40);
  const composed = roll(x, 0, 40);
  multiply(y, x).forEach((v, i) => near(v, composed[i]));
  let long = q;
  for (let i = 0; i < 10000; i++) long = roll(long, Math.sin(i), Math.cos(i));
  near(Math.hypot(...long), 1);
});

// At the contact point, rotational velocity must cancel translation.
test("rolling sign cancels contact velocity", () => {
  const dx = 0.0001,
    dy = 0.0002;
  const q = roll([0, 0, 0, 1], dx, dy);
  const omegaX = 2 * q[0],
    omegaY = 2 * q[1];
  near(dx - RADIUS * omegaY, 0, 1e-10);
  near(dy + RADIUS * omegaX, 0, 1e-10);
});

test("quadratic substeps bend smoothly, roll the same path, and agree at 30/60 fps across wraps", () => {
  let thirty = { ...initialBall(400, 800), x: 399, vx: 300 },
    sixty = { ...initialBall(400, 800), x: 399, vx: 300 };
  const tilt = { x: 0, y: 1 };
  const first = advance(thirty, tilt, 1 / 30, 400, 800);
  assert.ok(first.wrapped);
  assert.ok(first.steps.length > 4);
  let q = thirty.q;
  for (const step of first.steps) {
    assert.ok(Math.hypot(step.travel.x, step.travel.y) <= RADIUS * 0.25);
    assert.ok(step.dt <= 1 / 120);
    q.forEach((v, i) => near(v, step.rotation[i]));
    q = roll(q, step.travel.x, step.travel.y);
  }
  q.forEach((v, i) => near(v, first.ball.q[i]));
  const slopes = first.steps.map((s) => s.travel.y / s.travel.x);
  assert.ok(slopes.at(-1)! > slopes[0], "curve follows the evolving velocity tangent");
  for (let i = 0; i < 30; i++) thirty = advance(thirty, tilt, 1 / 30, 400, 800).ball;
  for (let i = 0; i < 60; i++) sixty = advance(sixty, tilt, 1 / 60, 400, 800).ball;
  near(thirty.x, sixty.x);
  near(thirty.y, sixty.y);
  thirty.q.forEach((v, i) => near(v, sixty.q[i]));
});

test("a gentle five-degree tilt moves the ball without a large phone angle", () => {
  let ball = initialBall(1000, 1000);
  for (let frame = 0; frame < 60; frame++) {
    ball = advance(ball, { x: Math.sin((5 * Math.PI) / 180), y: 0 }, 1 / 60, 1000, 1000).ball;
  }
  assert.ok(ball.x > 545, "gentle tilt should travel at least 45 points in one second");
  assert.ok(ball.vx > 75);
});
