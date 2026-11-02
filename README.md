# rn-tilt-pen

## About

Tilt your phone to roll a textured ball across a full-screen canvas and leave a trail of ink. Built with **Expo**, **React Native Skia**, and **Reanimated**. Just a ball and a canvas.

https://github.com/user-attachments/assets/9b63fa0d-826c-4882-a62b-20051ab414de

## Quick start

### Requirements

- Node.js and npm.
- **iOS native build:** macOS and Xcode.
- **Android native build:** Android Studio, the Android SDK, and a configured JDK.
- A physical phone with motion sensors to draw by tilting.

Install the dependencies:

```sh
npm ci
```

### Native build

Run on an iPhone:

```sh
npm run ios -- --device
```

Run on an Android emulator or connected device:

```sh
npm run android
```

For an already installed development build, start Metro with `npm start` (port **8091**).

> **Note:** Allow **Motion & Fitness** access when prompted on iPhone so the app can use motion sensors for tilt controls.

## How it works

### Tilt controls

[`useDrawing`](src/hooks/useDrawing.ts) reads the phone’s motion sensors about 60 times per second. It subtracts movement acceleration from the sensor reading to isolate gravity, then compares it with your opening pose. Tilting away from that pose accelerates the ball in that direction. A small dead zone filters out tiny movements when you hold the phone still.

On phones without the full DeviceMotion sensor set, it uses the accelerometer instead, smoothing the readings to reduce the effect of brief shakes. Both paths calibrate to your opening pose.

### Ball movement

The [physics helpers](src/helpers/physics.ts) update the ball’s speed, position, and rotation each frame. Resistance slows it down as you return to the neutral pose, and a speed limit keeps it controllable. Movement is split into small steps so curves and ink stay continuous, even when the ball moves quickly.

The ball rotates according to the distance it travels, making its texture roll with it. When it reaches an edge, it reappears on the opposite side, with the ink continuing across the seam.

### Ink trail

The [ink brush](src/helpers/inkBrush.ts) places overlapping stamps along the ball’s path. Each stamp samples the texture on the underside of the rolling ball, transferring its colors and pattern onto the canvas. Slow movement leaves a wider trail; faster movement makes it thinner. Small variations give the edges a less uniform feel.

Sharp turns and sudden changes in acceleration can throw out droplets. Larger splatters trigger a light haptic tap on a physical phone.

### Rendering

[`SkiaRenderer`](src/components/SkiaRenderer.tsx) draws the ball as a shaded sphere with a highlight and shadow. Ink accumulates on a separate offscreen surface, so existing strokes stay on the canvas without replaying the full drawing history each frame.

Reanimated worklets handle physics and ink updates on the UI thread without a React render for every frame. Motion pauses while the app is in the background. Shared ball, brush, and canvas settings live in [`src/constants`](src/constants/index.ts).

## License

[MIT](LICENSE).
