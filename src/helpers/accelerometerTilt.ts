import type { Vec2 } from "@/helpers/physics";

export function createAccelerometerTiltListener(onTilt: (tilt: Vec2) => void, android: boolean) {
  let neutral: Vec2 | undefined;
  let filtered: Vec2 = { x: 0, y: 0 };
  let previousTime = 0;

  return ({ x, y, timestamp }: Vec2 & { timestamp: number }) => {
    if (![x, y, timestamp].every(Number.isFinite)) return;
    // Android reports proper acceleration; iOS reports gravity with the opposite sign.
    const current = android ? { x: -x, y } : { x, y: -y };
    if (!neutral) {
      neutral = current;
      previousTime = timestamp;
    }
    const dt = Math.max(0, timestamp - previousTime);
    const blend = 1 - Math.exp(-dt / 0.12);
    filtered = {
      x: filtered.x + (current.x - neutral.x - filtered.x) * blend,
      y: filtered.y + (current.y - neutral.y - filtered.y) * blend,
    };
    previousTime = timestamp;
    onTilt(filtered);
  };
}
