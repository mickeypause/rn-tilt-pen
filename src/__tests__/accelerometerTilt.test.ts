import { test } from "node:test";
import assert from "node:assert/strict";
import { createAccelerometerTiltListener } from "@/helpers/accelerometerTilt";
import { advance, initialBall, type Vec2 } from "@/helpers/physics";

test("Android accelerometer calibrates the opening pose and drives the ball downhill", () => {
  let tilt: Vec2 = { x: 0, y: 0 };
  const sample = createAccelerometerTiltListener((value) => {
    tilt = value;
  }, true);
  sample({ x: 0.1, y: 0.3, timestamp: 1 });
  assert.deepEqual(tilt, { x: 0, y: 0 });
  let ball = initialBall(1000, 1000);
  for (let frame = 1; frame <= 60; frame++) {
    sample({ x: 0.1 - Math.sin((5 * Math.PI) / 180), y: 0.3, timestamp: 1 + frame / 60 });
    ball = advance(ball, tilt, 1 / 60, 1000, 1000).ball;
  }
  assert.ok(ball.x > 535, "a gentle rightward tilt should move the ball right");
  assert.equal(ball.y, 500);
});

test("accelerometer filtering suppresses a brief jolt and handles platform signs", () => {
  for (const android of [true, false]) {
    let tilt: Vec2 = { x: 0, y: 0 };
    const sample = createAccelerometerTiltListener((value) => {
      tilt = value;
    }, android);
    sample({ x: 0, y: 0, timestamp: 1 });
    sample({ x: android ? -1 : 1, y: android ? 1 : -1, timestamp: 1 + 1 / 60 });
    assert.ok(tilt.x > 0 && tilt.x < 0.15);
    assert.ok(tilt.y > 0 && tilt.y < 0.15);
    sample({ x: NaN, y: 0, timestamp: 2 });
    assert.ok(Number.isFinite(tilt.x));
    for (let frame = 2; frame <= 120; frame++) {
      sample({ x: 0, y: 0, timestamp: 1 + frame / 60 });
    }
    assert.ok(Math.hypot(tilt.x, tilt.y) < 0.001);
  }
});
