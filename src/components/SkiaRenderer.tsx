import { PixelRatio } from "react-native";
import {
  Canvas,
  Fill,
  Image,
  ImageShader,
  Shader,
  Skia,
  TileMode,
  FilterMode,
  MipmapMode,
  type SkImage,
  type SkSurface,
} from "@shopify/react-native-skia";
import { useDerivedValue, useFrameCallback, useSharedValue } from "react-native-reanimated";
import { CANVAS_COLOR, RADIUS, RING_SIZE } from "@/constants";
import type { Drawing } from "@/hooks/useDrawing";
import type { Texture } from "@/helpers/textures";

const common = `
uniform shader tex;
uniform float2 size;
uniform float2 center;
uniform float4 rotation;
uniform float radius;
uniform float pixelSize;
uniform float2 textureSize;
float3 unrotate(float3 v) {
  float3 u = -rotation.xyz;
  return v + 2.0 * cross(u, cross(u, v) + rotation.w * v);
}
half4 levelAt(float2 uv, float level) {
  float scale=exp2(-level);
  float2 dimensions=textureSize*scale;
  float top=2.0*textureSize.y*(1.0-scale);
  float2 p=clamp(float2(fract(uv.x),uv.y)*dimensions,float2(.5),dimensions-.5);
  return tex.eval(p+float2(0,top));
}
half4 sampleUV(float2 uv, float lod) {
  lod=clamp(lod,0.0,4.0);
  float level=floor(lod);
  return mix(levelAt(uv,level),levelAt(uv,min(4.0,level+1.0)),fract(lod));
}
half4 textureAt(float3 n) {
  float3 p = unrotate(n);
  float2 uv = float2(atan(p.z, p.x) / 6.2831853 + 0.5, asin(clamp(p.y, -1.0, 1.0)) / 3.14159265 + 0.5);
  float footprint=max(.025,abs(n.z)*sqrt(max(.0004,1.0-p.y*p.y)));
  float lod=max(0.0,log2(textureSize.x*pixelSize/(6.2831853*radius*footprint)));
  return sampleUV(uv,lod);
}
float hash(float2 p) { return fract(sin(dot(p, float2(12.9898,78.233))) * 43758.5453); }
float noise(float2 p) {
  float2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
  return mix(mix(hash(i),hash(i+float2(1,0)),f.x),mix(hash(i+float2(0,1)),hash(i+1.0),f.x),f.y);
}
`;

const sphereSource =
  common +
  `
half4 main(float2 xy) {
  float2 d = xy - center;
  d -= floor(d / size + 0.5) * size;
  float2 shadow = (d - float2(15.0, 23.0)) / float2(radius * 1.05, radius * .82);
  float alpha = exp(-dot(shadow, shadow) * 2.0) * .26;
  float2 p = d / radius;
  float rr = dot(p, p);
  if (length(d) > radius + pixelSize) return half4(0.12 * alpha, 0.13 * alpha, 0.16 * alpha, alpha);
  float3 n = normalize(float3(p, sqrt(max(0.0, 1.0 - rr))));
  float3 light = normalize(float3(-.55, -.65, 1.15));
  float diffuse = .77 + .23 * max(0.0, dot(n, light));
  float specular = pow(max(0.0, dot(n, normalize(light + float3(0,0,1)))), 210.0) * .92;
  half3 c = textureAt(n).rgb * diffuse + specular;
  float coverage = 1.0 - smoothstep(-.625*pixelSize, .625*pixelSize, length(d)-radius);
  return half4(c * coverage + half3(.12,.13,.16)*alpha*(1.0-coverage), coverage+alpha*(1.0-coverage));
}`;

const inkSource =
  common +
  `
uniform float4 brush;
uniform float2 contactUV;
uniform float grain;
half4 main(float2 xy) {
  float2 d = xy - center;
  float co = cos(brush.z), si = sin(brush.z);
  float2 local = float2(co * d.x + si * d.y, -si * d.x + co * d.y);
  float2 p = local / float2(brush.x * brush.y, brush.x);
  float edge = 1.0 - noise((xy + grain) * 1.2) * .08;
  float distance = (length(p)-edge)*brush.x;
  float coverage = 1.0-smoothstep(-.625*pixelSize,.625*pixelSize,distance);
  float2 contact = d / radius;
  half3 c = brush.w > .5 ? sampleUV(contactUV,max(0.0,log2(textureSize.x*pixelSize/(6.2831853*radius)))).rgb
    : textureAt(float3(contact, -sqrt(max(0.0, 1.0 - dot(contact,contact))))).rgb;
  return half4(c*coverage, coverage);
}`;

export function SkiaRenderer({
  drawing,
  texture,
  width,
  height,
}: {
  drawing: Drawing;
  texture: Texture;
  width: number;
  height: number;
}) {
  const density = PixelRatio.get();
  const { width: textureWidth, height: textureHeight } = texture;
  const sphere = Skia.RuntimeEffect.Make(sphereSource);
  if (!sphere) throw new Error("Sphere SkSL did not compile");
  const ink = Skia.RuntimeEffect.Make(inkSource);
  if (!ink) throw new Error("Ink SkSL did not compile");
  const surface = useSharedValue<SkSurface | null>(null);
  const image = useSharedValue<SkImage | null>(null);
  const cursor = useSharedValue(0);
  const texShaders = [
    texture.mipAtlas.makeShaderOptions(
      TileMode.Clamp,
      TileMode.Clamp,
      FilterMode.Linear,
      MipmapMode.None,
    ),
  ];
  const paint = Skia.Paint();
  paint.setAntiAlias(true);
  const { ball, samples, serial } = drawing;

  useFrameCallback(() => {
    if (!surface.value) {
      surface.value = Skia.Surface.MakeOffscreen(
        Math.ceil(width * density),
        Math.ceil(height * density),
      );
      surface.value?.getCanvas().clear(Skia.Color("transparent"));
      surface.value?.getCanvas().scale(density, density);
    }
    const target = surface.value;
    if (!target) return;
    const canvas = target.getCanvas();
    let changed = false;
    const end = serial.value;
    const ring = samples.value;
    for (let id = Math.max(cursor.value + 1, end - RING_SIZE + 1); id <= end; id++) {
      const stamp = ring[id % RING_SIZE];
      if (!stamp || stamp.id !== id) continue;
      // Duplicate only the contact patch at seams; never connect wrapped positions.
      for (let ix = -1; ix <= 1; ix++)
        for (let iy = -1; iy <= 1; iy++) {
          const x = stamp.x + ix * width,
            y = stamp.y + iy * height;
          const r = stamp.radius * stamp.aspect + 1;
          if (x + r < 0 || x - r > width || y + r < 0 || y - r > height) continue;
          paint.setShader(
            ink.makeShaderWithChildren(
              [
                width,
                height,
                x,
                y,
                ...stamp.q,
                RADIUS,
                1 / density,
                textureWidth,
                textureHeight,
                stamp.radius,
                stamp.aspect,
                stamp.angle,
                stamp.kind,
                ...stamp.uv,
                stamp.grain,
              ],
              texShaders,
            ),
          );
          canvas.drawRect(Skia.XYWHRect(x - r, y - r, r * 2, r * 2), paint);
        }
      changed = true;
    }
    cursor.value = end;
    if (changed) {
      target.flush();
      image.value = target.makeImageSnapshot();
    }
  });

  const uniforms = useDerivedValue(() => ({
    size: [width, height],
    center: [ball.value.x, ball.value.y],
    rotation: ball.value.q,
    radius: RADIUS,
    pixelSize: 1 / density,
    textureSize: [textureWidth, textureHeight],
  }));
  return (
    <Canvas style={{ width, height }} testID="skia-canvas">
      <Fill color={CANVAS_COLOR} />
      <Image
        sampling={{ filter: FilterMode.Linear }}
        image={image}
        x={0}
        y={0}
        width={width}
        height={height}
      />
      <Fill>
        <Shader source={sphere} uniforms={uniforms}>
          <ImageShader
            image={texture.mipAtlas}
            tx="clamp"
            ty="clamp"
            width={texture.width}
            height={texture.height * 2}
            sampling={{ filter: FilterMode.Linear }}
          />
        </Shader>
      </Fill>
    </Canvas>
  );
}
