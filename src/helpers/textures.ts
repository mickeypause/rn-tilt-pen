import { inkArt } from "@/helpers/inkArt";
import {
  AlphaType,
  ColorType,
  FilterMode,
  MipmapMode,
  Skia,
  type SkImage,
} from "@shopify/react-native-skia";

export const TEX_WIDTH = 2048;
export const TEX_HEIGHT = 1024;
export type Texture = { mipAtlas: SkImage; width: number; height: number };

function fromPixels(pixels: Uint8Array, width = TEX_WIDTH, height = TEX_HEIGHT): Texture {
  const image = Skia.Image.MakeImage(
    { width, height, colorType: ColorType.RGBA_8888, alphaType: AlphaType.Opaque },
    Skia.Data.fromBytes(pixels),
    width * 4,
  );
  if (!image) throw new Error("Could not create texture image");
  const mips = [image];
  // Skia's JS binding does not expose native mipmap allocation; retain prefiltered levels.
  for (let level = 1; level <= 4; level++) {
    const w = width >> level,
      h = height >> level;
    const surface = Skia.Surface.MakeOffscreen(w, h);
    if (!surface) throw new Error("Could not allocate artwork mip level");
    surface
      .getCanvas()
      .drawImageRectOptions(
        mips[level - 1],
        Skia.XYWHRect(0, 0, w * 2, h * 2),
        Skia.XYWHRect(0, 0, w, h),
        FilterMode.Linear,
        MipmapMode.None,
      );
    surface.flush();
    mips.push(surface.makeImageSnapshot());
    surface.dispose();
  }
  const atlas = Skia.Surface.MakeOffscreen(width, height * 2);
  if (!atlas) throw new Error("Could not allocate artwork mip atlas");
  let top = 0;
  for (const mip of mips) {
    atlas.getCanvas().drawImage(mip, 0, top);
    top += mip.height();
  }
  atlas.flush();
  const snapshot = atlas.makeImageSnapshot();
  // The UI renderer cannot sample a texture owned by the JS-side GPU context.
  const mipAtlas = snapshot.makeNonTextureImage();
  if (!mipAtlas) throw new Error("Could not transfer mip atlas to the UI renderer");
  snapshot.dispose();
  atlas.dispose();
  mips.slice(1).forEach((mip) => mip.dispose());
  image.dispose();
  return { mipAtlas, width, height };
}

export function builtinTexture(): Texture {
  const svg = Skia.SVG.MakeFromString(inkArt("#0000e7"));
  const surface = Skia.Surface.MakeOffscreen(TEX_WIDTH, TEX_HEIGHT);
  if (!svg || !surface) throw new Error("Could not create ink artwork");
  surface.getCanvas().scale(TEX_WIDTH / 512, TEX_HEIGHT / 256);
  surface.getCanvas().drawSvg(svg, 512, 256);
  surface.flush();
  const image = surface.makeImageSnapshot();
  const pixels = image.readPixels(0, 0, {
    width: TEX_WIDTH,
    height: TEX_HEIGHT,
    colorType: ColorType.RGBA_8888,
    alphaType: AlphaType.Opaque,
  });
  if (!pixels) throw new Error("Could not read ink artwork");
  if (pixels[pixels.length - 1] !== 255)
    throw new Error("Artwork did not fill the high-resolution atlas");
  const texture = fromPixels(new Uint8Array(pixels));
  image.dispose();
  surface.dispose();
  svg.dispose();
  return texture;
}
