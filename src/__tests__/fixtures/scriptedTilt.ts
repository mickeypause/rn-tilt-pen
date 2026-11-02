import type { Vec2 } from "@/helpers/physics";
export const FLICK_DURATION = 6.3;
export function scriptedTilt(seconds: number): Vec2 {
  "worklet";
  if (seconds < 0.9) return { x: 1, y: 0.15 };
  if (seconds < 1.8) return { x: -0.9, y: -0.65 };
  if (seconds < 2.7) return { x: 0.3, y: 1 };
  if (seconds < 3.6) return { x: 0.9, y: -0.7 };
  if (seconds < 4.5) return { x: -1, y: 0 };
  if (seconds < 5.4) return { x: 0, y: -1 };
  return { x: 0, y: 0 };
}
