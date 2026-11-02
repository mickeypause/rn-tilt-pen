import { useEffect } from "react";
import { AppState, Platform } from "react-native";
import * as Device from "expo-device";
import * as Haptics from "expo-haptics";
import { Accelerometer, DeviceMotion } from "expo-sensors";
import { useFrameCallback, useSharedValue } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { DEFAULT_BRUSH, RING_SIZE } from "@/constants";
import { advance, initialBall, roll, type Vec2 } from "@/helpers/physics";
import { brushStep, contactUV, initialBrush, type InkCommand } from "@/helpers/inkBrush";
import { createAccelerometerTiltListener } from "@/helpers/accelerometerTilt";

export function useDrawing(width: number, height: number) {
  const ball = useSharedValue(initialBall(width, height));
  const samples = useSharedValue<InkCommand[]>([]);
  const serial = useSharedValue(0);
  const brush = useSharedValue(initialBrush());
  const hapticTick = () => {
    if (Device.isDevice) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
  };
  const tilt = useSharedValue<Vec2>({ x: 0, y: 0 });
  const active = useSharedValue(true);

  useEffect(() => {
    let cancelled = false;
    let subscription: ReturnType<typeof DeviceMotion.addListener> | undefined;
    let calibration: Vec2 | undefined;
    (async () => {
      if (!Device.isDevice) return;
      if (!(await DeviceMotion.isAvailableAsync())) {
        if (!(await Accelerometer.isAvailableAsync()) || cancelled) return;
        const permission = await Accelerometer.requestPermissionsAsync();
        if (cancelled || !permission.granted) return;
        Accelerometer.setUpdateInterval(1000 / 60);
        subscription = Accelerometer.addListener(
          createAccelerometerTiltListener((value) => tilt.set(value), Platform.OS === "android"),
        );
        return;
      }
      const permission = await DeviceMotion.requestPermissionsAsync();
      if (cancelled || !permission.granted) return;
      DeviceMotion.setUpdateInterval(1000 / 60);
      subscription = DeviceMotion.addListener((event) => {
        const gravity = event.accelerationIncludingGravity;
        const movement = event.acceleration;
        if (!gravity) return;
        const current = {
          x: (gravity.x - (movement?.x ?? 0)) / 9.81,
          y: -(gravity.y - (movement?.y ?? 0)) / 9.81,
        };
        // The opening pose replaces the former manual calibration control.
        if (calibration === undefined) calibration = current;
        tilt.set({ x: current.x - calibration.x, y: current.y - calibration.y });
      });
    })().catch(() => {
      tilt.set({ x: 0, y: 0 });
    });
    return () => {
      cancelled = true;
      subscription?.remove();
    };
  }, [tilt]);

  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      active.value = state === "active";
    });
    return () => sub.remove();
  }, [active]);

  useFrameCallback((frame) => {
    if (!active.value || width <= 0 || height <= 0) return;
    const dt = Math.min((frame.timeSincePreviousFrame ?? 16.67) / 1000, 1 / 30);
    const before = ball.value;
    const next = advance(before, tilt.value, dt, width, height);
    for (const step of next.steps) {
      const ink = brushStep(
        brush.value,
        {
          ...step,
          contactUV: contactUV(roll(step.rotation, step.travel.x, step.travel.y)),
          page: { x: width, y: height },
        },
        DEFAULT_BRUSH,
        serial.value,
      );
      brush.value = ink.state;
      const stamps = ink.commands;
      if (ink.bigSplatter) scheduleOnRN(hapticTick);
      if (stamps.length) {
        samples.modify((ring) => {
          for (const stamp of stamps) ring[stamp.id % RING_SIZE] = stamp;
          return ring;
        });
        serial.value += stamps.length;
      }
    }
    ball.value = next.ball;
  });

  return { ball, samples, serial };
}

export type Drawing = ReturnType<typeof useDrawing>;
