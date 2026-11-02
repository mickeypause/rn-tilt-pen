import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_BRUSH, MAX_SPEED, RADIUS } from "@/constants";
import {
  brushStep,
  contactUV,
  initialBrush,
  splatterStrength,
  widthForSpeed,
  type BrushInput,
  type InkCommand,
} from "@/helpers/inkBrush";
import { roll } from "@/helpers/physics";
const near = (a: number, b: number, e = 1e-8) => assert.ok(Math.abs(a - b) < e, `${a} != ${b}`);
const input = (changes: Partial<BrushInput> = {}): BrushInput => ({
  position: { x: 500, y: 500 },
  velocity: { x: 200, y: 0 },
  acceleration: { x: 0, y: 0 },
  rotation: [0, 0, 0, 1],
  contactUV: [0.25, 0.5],
  travel: { x: 200 / 60, y: 0 },
  dt: 1 / 60,
  page: { x: 2000, y: 2000 },
  ...changes,
});

test("width decreases monotonically from 28% to 12.5% of diameter and clamps", () => {
  near(widthForSpeed(0, DEFAULT_BRUSH), RADIUS * 2 * 0.28);
  near(widthForSpeed(MAX_SPEED, DEFAULT_BRUSH), RADIUS * 2 * 0.125);
  near(widthForSpeed(9999, DEFAULT_BRUSH), widthForSpeed(MAX_SPEED, DEFAULT_BRUSH));
  let last = Infinity;
  for (let v = 0; v <= MAX_SPEED; v++) {
    const width = widthForSpeed(v, DEFAULT_BRUSH);
    assert.ok(width <= last);
    last = width;
  }
});
test("width low-pass is refresh-rate independent, arc wobble cannot grow a stationary pool", () => {
  let a = initialBrush(),
    b = initialBrush();
  for (let i = 0; i < 60; i++)
    a = brushStep(
      a,
      input({ velocity: { x: 420, y: 0 }, travel: { x: 7, y: 0 } }),
      DEFAULT_BRUSH,
      0,
    ).state;
  for (let i = 0; i < 120; i++)
    b = brushStep(
      b,
      input({ velocity: { x: 420, y: 0 }, travel: { x: 3.5, y: 0 }, dt: 1 / 120 }),
      DEFAULT_BRUSH,
      0,
    ).state;
  near(a.width, b.width);
  const first = brushStep(initialBrush(), input({ velocity: { x: 420, y: 0 } }), DEFAULT_BRUSH, 0);
  assert.ok(first.state.width > widthForSpeed(420, DEFAULT_BRUSH));
  assert.ok(first.commands[0].radius > 8, "a blunt start, not an artificial taper");
  for (let i = 0; i < 600; i++) {
    const next = brushStep(
      a,
      input({ velocity: { x: 0, y: 0 }, travel: { x: 0, y: 0 } }),
      DEFAULT_BRUSH,
      0,
    );
    assert.equal(next.commands.length, 0);
    a = next.state;
  }
});
for (const fps of [30, 60])
  test(`5000 px/s at ${fps} fps has continuous opaque coverage and dense subpixel spacing`, () => {
    let state = initialBrush(),
      serial = 0,
      x = 200,
      q: [number, number, number, number] = [0, 0, 0, 1];
    const patches: InkCommand[] = [];
    for (let frame = 0; frame < fps * 2; frame++) {
      const travel = 5000 / fps;
      const result = brushStep(
        state,
        input({
          position: { x, y: 500 },
          velocity: { x: 5000, y: 0 },
          travel: { x: travel, y: 0 },
          rotation: q,
          dt: 1 / fps,
          page: { x: 20000, y: 1000 },
        }),
        DEFAULT_BRUSH,
        serial,
      );
      state = result.state;
      serial += result.commands.length;
      patches.push(...result.commands.filter((c) => c.kind === 0));
      q = roll(q, travel, 0);
      x += travel;
    }
    let coveredUntil = 200;
    for (let i = 0; i < patches.length; i++) {
      const c = patches[i],
        opaqueRadius = c.radius * 0.92 - 0.625 / 3;
      assert.ok(
        c.x - opaqueRadius <= coveredUntil,
        "gap in conservative fully opaque centerline coverage",
      );
      coveredUntil = Math.max(coveredUntil, c.x + opaqueRadius);
      assert.ok(c.radius * 2 >= RADIUS * 2 * 0.07, "fast line remains visible");
      if (i)
        assert.ok(
          c.x - patches[i - 1].x <= 0.2 * Math.min(c.radius, patches[i - 1].radius) * 2 + 1e-8,
          "spacing exceeds 0.2 width",
        );
      const expected = roll([0, 0, 0, 1], c.x - 200, 0);
      near(Math.abs(c.q.reduce((sum, v, j) => sum + v * expected[j], 0)), 1, 1e-7);
    }
    assert.ok(coveredUntil >= x, "coverage reaches the last frame endpoint");
  });
test("splatter requires fast curvature or jerk, is seeded, and respects cooldown/amount", () => {
  assert.equal(splatterStrength(50, 10000, 100000), 0);
  assert.equal(splatterStrength(300, 0, 0), 0);
  assert.ok(splatterStrength(300, 500, 0) > 1);
  assert.ok(splatterStrength(300, 0, 20000) > 1);
  const flick = input({
    velocity: { x: 320, y: 0 },
    acceleration: { x: 0, y: 800 },
    contactUV: [0.3, 0.6],
  });
  const a = brushStep(initialBrush(42), flick, DEFAULT_BRUSH, 100);
  const b = brushStep(initialBrush(42), flick, DEFAULT_BRUSH, 100);
  assert.deepEqual(a, b);
  const drops = a.commands.filter((c) => c.kind === 1);
  assert.ok(drops.length >= 6 && drops.length <= 12);
  assert.ok(drops.every((c) => c.uv[0] === 0.3 && c.uv[1] === 0.6));
  const again = brushStep(a.state, flick, DEFAULT_BRUSH, 120);
  assert.equal(again.commands.filter((c) => c.kind === 1).length, 0);
  assert.equal(
    brushStep(initialBrush(), flick, { ...DEFAULT_BRUSH, splatter: 0 }, 0).commands.filter(
      (c) => c.kind === 1,
    ).length,
    0,
  );
});
test("seeded droplets land outside the curve and forward, within two ball diameters", () => {
  let elongated = 0,
    count = 0;
  const flick = input({ velocity: { x: 320, y: 0 }, acceleration: { x: 0, y: 800 } });
  for (let seed = 1; seed < 80; seed++) {
    for (const c of brushStep(initialBrush(seed), flick, DEFAULT_BRUSH, 0).commands.filter(
      (c) => c.kind === 1,
    )) {
      const dx = c.x - (500 + flick.travel.x),
        dy = c.y - 500;
      assert.ok(dx > 0 && dy < 0);
      assert.ok(Math.hypot(dx, dy) <= RADIUS * 4);
      assert.ok(c.radius >= 0.5 && c.radius <= 5.5);
      if (c.aspect > 1) elongated++;
      count++;
    }
  }
  assert.ok(elongated / count > 0.15 && elongated / count < 0.35);
});
test("contact UV follows exact rolling arc length and patches use accumulated quaternions", () => {
  near(contactUV([0, 0, 0, 1])[0], 0.25);
  near(contactUV(roll([0, 0, 0, 1], RADIUS, 0))[0], 0.25 + 1 / (2 * Math.PI));
  const start = roll([0, 0, 0, 1], 12, 20);
  const result = brushStep(
    initialBrush(),
    input({ rotation: start, travel: { x: 5, y: 3 } }),
    DEFAULT_BRUSH,
    50,
  );
  assert.deepEqual(result.commands[0].q, start);
  assert.deepEqual(result.commands[0].uv, contactUV(start));
  result.commands.forEach((c, i) => assert.equal(c.id, 51 + i));
});
test("seam stamps stay near the seam, never connect wrapped positions", () => {
  const result = brushStep(
    initialBrush(),
    input({ position: { x: 99, y: 99 }, travel: { x: 4, y: 4 }, page: { x: 100, y: 100 } }),
    DEFAULT_BRUSH,
    0,
  );
  assert.ok(result.commands.length > 1);
  assert.ok(result.commands.every((c) => (c.x > 95 || c.x < 5) && (c.y > 95 || c.y < 5)));
});

test("tilt-driven flick sequence reaches high speed and produces bounded splatters", async () => {
  const { advance, initialBall } = await import("@/helpers/physics");
  const { scriptedTilt } = await import("@/__tests__/fixtures/scriptedTilt");
  let ball = initialBall(402, 874),
    brush = initialBrush(42),
    serial = 0,
    drops = 0,
    maxSpeed = 0,
    minWidth = 100;
  for (let i = 0; i < 600; i++) {
    const before = ball,
      dt = 1 / 60;
    const next = advance(before, scriptedTilt(i * dt), dt, 402, 874);
    ball = next.ball;
    for (const step of next.steps) {
      const result = brushStep(
        brush,
        input({
          ...step,
          contactUV: contactUV(roll(step.rotation, step.travel.x, step.travel.y)),
          page: { x: 402, y: 874 },
        }),
        DEFAULT_BRUSH,
        serial,
      );
      brush = result.state;
      serial += result.commands.length;
      drops += result.commands.filter((c) => c.kind === 1).length;
      assert.ok(result.commands.every((c) => c.x >= 0 && c.x < 402 && c.y >= 0 && c.y < 874));
    }
    maxSpeed = Math.max(maxSpeed, Math.hypot(ball.vx, ball.vy));
    minWidth = Math.min(minWidth, brush.width);
  }
  assert.ok(maxSpeed > 265);
  assert.ok(minWidth < 11 && minWidth >= RADIUS * 2 * 0.125);
  assert.ok(drops >= 18 && drops <= 144, `expected occasional flick splatters, got ${drops}`);
});

test("a stroke crosses either wrap seam with full coverage and no middle-of-page bridge", () => {
  for (const direction of [-1, 1]) {
    const start = direction === 1 ? 98 : 2;
    const result = brushStep(
      initialBrush(),
      input({
        position: { x: start, y: 50 },
        velocity: { x: direction * 5000, y: 0 },
        travel: { x: direction * 12, y: 0 },
        page: { x: 100, y: 100 },
      }),
      { ...DEFAULT_BRUSH, splatter: 0 },
      0,
    );
    assert.ok(result.commands.every((c) => c.x < 20 || c.x > 80));
    for (let distance = 0; distance <= 12; distance += 0.1) {
      const x = (((start + direction * distance) % 100) + 100) % 100;
      assert.ok(
        result.commands.some(
          (c) =>
            Math.min(Math.abs(c.x - x), 100 - Math.abs(c.x - x)) <= c.radius * 0.92 - 0.625 / 3,
        ),
        "seam gap",
      );
    }
  }
});
