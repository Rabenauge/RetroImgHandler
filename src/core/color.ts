import type { RgbColor, RgbaImage } from "./types";

export function clampByte(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

export function colorDistance(a: RgbColor, b: RgbColor): number {
  const r = a.r - b.r;
  const g = a.g - b.g;
  const blue = a.b - b.b;
  return 0.2126 * r * r + 0.7152 * g * g + 0.0722 * blue * blue;
}

export function nearestColorIndex(color: RgbColor, palette: RgbColor[]): number {
  let best = 0;
  let distance = Number.POSITIVE_INFINITY;
  for (let i = 0; i < palette.length; i += 1) {
    const next = colorDistance(color, palette[i]!);
    if (next < distance) {
      distance = next;
      best = i;
    }
  }
  return best;
}

export function indexedToRgba(indices: Uint8Array, width: number, height: number, palette: RgbColor[]): RgbaImage {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i += 1) {
    const color = palette[indices[i] ?? 0] ?? { r: 0, g: 0, b: 0 };
    data[i * 4] = color.r;
    data[i * 4 + 1] = color.g;
    data[i * 4 + 2] = color.b;
    data[i * 4 + 3] = color.a ?? 255;
  }
  return { width, height, data };
}

export function rgbaColorAt(image: RgbaImage, index: number): RgbColor {
  return {
    r: image.data[index * 4] ?? 0,
    g: image.data[index * 4 + 1] ?? 0,
    b: image.data[index * 4 + 2] ?? 0,
    a: image.data[index * 4 + 3] ?? 255
  };
}

export function rgb12(value: number): RgbColor {
  return {
    r: ((value >>> 8) & 0xf) * 17,
    g: ((value >>> 4) & 0xf) * 17,
    b: (value & 0xf) * 17
  };
}
