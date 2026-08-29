import { RetroImageError } from "./errors";
import { clampByte, colorDistance, indexedToRgba, nearestColorIndex, rgbaColorAt } from "./color";
import type {
  AnalysisIssue,
  AnalysisResult,
  CodecTarget,
  ConversionOptions,
  ConversionResult,
  ConversionStep,
  FormatModeDefinition,
  RasterDocument,
  RetroImageDocument,
  RgbComponentPrecision,
  RgbColor,
  RgbaImage,
  DisplayProfile
} from "./types";

export function imagePreview(image: RgbaImage | RetroImageDocument): RgbaImage {
  return "kind" in image ? image.preview : image;
}

/** Apply only the explicit size operation shared by target-native converters. */
export function prepareConversionImage(
  image: RgbaImage | RetroImageDocument,
  mode: FormatModeDefinition,
  options: ConversionOptions
): { image: RgbaImage; steps: ConversionStep[] } {
  const source = imagePreview(image);
  const range = mode.dimensionRange;
  const size = mode.dimensions[0] ?? (range ? {
    width: Math.max(range.minWidth, Math.min(range.maxWidth, source.width)),
    height: Math.max(range.minHeight, Math.min(range.maxHeight, source.height))
  } : undefined);
  if (!size) throw new RetroImageError("UNSUPPORTED_MODE", `Mode ${mode.id} has no dimensions`);
  if (source.width === size.width && source.height === size.height) return { image: source, steps: [] };
  if (!options.resize || options.resize === "none") {
    throw new RetroImageError("VALIDATION_FAILED", "Image dimensions require an explicit resize option");
  }
  const resized = options.resize === "nearest"
    ? resizeNearest(source, size.width, size.height)
    : cropOrPad(source, size.width, size.height, options.background ?? { r: 0, g: 0, b: 0 });
  return {
    image: resized,
    steps: [{ operation: "resize", message: `${source.width}x${source.height} converted to ${size.width}x${size.height}` }]
  };
}

export function analyzeDimensions(
  image: RgbaImage | RetroImageDocument,
  target: CodecTarget,
  mode: FormatModeDefinition
): AnalysisResult {
  const preview = imagePreview(image);
  const inRange = mode.dimensionRange !== undefined
    && preview.width >= mode.dimensionRange.minWidth
    && preview.width <= mode.dimensionRange.maxWidth
    && preview.height >= mode.dimensionRange.minHeight
    && preview.height <= mode.dimensionRange.maxHeight
    && preview.width % (mode.dimensionRange.widthAlignment ?? 1) === 0
    && preview.height % (mode.dimensionRange.heightAlignment ?? 1) === 0;
  const validSize = mode.dimensions.some(({ width, height }) => width === preview.width && height === preview.height) || inRange;
  const issues: AnalysisIssue[] = [];
  if (!validSize) {
    issues.push({
      severity: "error",
      code: "DIMENSIONS_MISMATCH",
      message: `${preview.width}x${preview.height} is not valid for ${mode.label}`,
      rule: "dimensions",
      details: {
        actual: [preview.width, preview.height],
        allowed: mode.dimensions.map((size) => [size.width, size.height]),
        range: mode.dimensionRange ? {
          minWidth: mode.dimensionRange.minWidth,
          maxWidth: mode.dimensionRange.maxWidth,
          minHeight: mode.dimensionRange.minHeight,
          maxHeight: mode.dimensionRange.maxHeight,
          widthAlignment: mode.dimensionRange.widthAlignment ?? 1,
          heightAlignment: mode.dimensionRange.heightAlignment ?? 1
        } : null
      }
    });
  }
  issues.push(...analyzePaletteCapabilities(image, target, mode));
  return { valid: issues.length === 0, target, issues };
}

function resizeNearest(source: RgbaImage, width: number, height: number): RgbaImage {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    const sy = Math.min(source.height - 1, Math.floor((y * source.height) / height));
    for (let x = 0; x < width; x += 1) {
      const sx = Math.min(source.width - 1, Math.floor((x * source.width) / width));
      const from = (sy * source.width + sx) * 4;
      data.set(source.data.subarray(from, from + 4), (y * width + x) * 4);
    }
  }
  return { width, height, data };
}

function cropOrPad(source: RgbaImage, width: number, height: number, background: RgbColor): RgbaImage {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i += 1) {
    data.set([background.r, background.g, background.b, background.a ?? 255], i * 4);
  }
  const copyWidth = Math.min(width, source.width);
  const copyHeight = Math.min(height, source.height);
  for (let y = 0; y < copyHeight; y += 1) {
    data.set(source.data.subarray(y * source.width * 4, (y * source.width + copyWidth) * 4), y * width * 4);
  }
  return { width, height, data };
}

interface ColorBucket {
  colors: RgbColor[];
}

function gridValue(index: number, bits: number): number {
  const maximum = (1 << bits) - 1;
  return Math.round(index * 255 / maximum);
}

function quantizeComponentToGrid(value: number, bits: number): number {
  const maximum = (1 << bits) - 1;
  const scaled = Math.max(0, Math.min(255, value)) * maximum / 255;
  const lower = gridValue(Math.floor(scaled), bits);
  const upper = gridValue(Math.ceil(scaled), bits);
  return Math.abs(value - lower) <= Math.abs(value - upper) ? lower : upper;
}

/** Resolve the exact RGB grid for a concrete hardware display profile. */
export function resolveRgbComponentPrecision(
  mode: FormatModeDefinition,
  displayProfile: DisplayProfile
): RgbComponentPrecision | undefined {
  const selected = mode.palette?.componentPrecision?.find(({ hardwareProfiles }) => hardwareProfiles.includes(displayProfile.hardware));
  if (!selected) return undefined;
  return { redBits: selected.redBits, greenBits: selected.greenBits, blueBits: selected.blueBits };
}

/** True when all RGB components are exactly representable on a hardware grid. */
export function isRgbOnComponentGrid(color: RgbColor, precision: RgbComponentPrecision): boolean {
  return color.r === quantizeComponentToGrid(color.r, precision.redBits)
    && color.g === quantizeComponentToGrid(color.g, precision.greenBits)
    && color.b === quantizeComponentToGrid(color.b, precision.blueBits);
}

/** Deterministically map RGB to the nearest hardware grid without dithering. */
export function quantizeRgbToComponentGrid(color: RgbColor, precision: RgbComponentPrecision): RgbColor {
  const quantized: RgbColor = {
    r: quantizeComponentToGrid(color.r, precision.redBits),
    g: quantizeComponentToGrid(color.g, precision.greenBits),
    b: quantizeComponentToGrid(color.b, precision.blueBits)
  };
  if (color.a !== undefined) quantized.a = color.a;
  return quantized;
}

function visibleColors(image: RgbaImage): RgbColor[] {
  const colors = new Map<string, RgbColor>();
  for (let pixel = 0; pixel < image.width * image.height; pixel += 1) {
    if (image.data[pixel * 4 + 3] === 0) continue;
    const color = rgbaColorAt(image, pixel);
    colors.set(`${color.r},${color.g},${color.b}`, { r: color.r, g: color.g, b: color.b });
  }
  return [...colors.values()];
}

/** Analyze display-color and exact RGB-grid rules declared by public mode metadata. */
export function analyzePaletteCapabilities(
  image: RgbaImage | RetroImageDocument,
  target: CodecTarget,
  mode: FormatModeDefinition
): AnalysisIssue[] {
  const capability = mode.palette;
  if (!capability || capability.model === "sampled-direct" || capability.model === "structured-registers") return [];
  const colors = visibleColors(imagePreview(image));
  const issues: AnalysisIssue[] = [];
  if (colors.length > capability.displayColorLimit) {
    issues.push({
      severity: "error",
      code: "TOO_MANY_COLORS",
      message: `${colors.length} visible colors exceed the ${capability.displayColorLimit}-color display limit`,
      rule: "palette.displayColorLimit",
      details: { actual: colors.length, maximum: capability.displayColorLimit }
    });
  }
  const precision = resolveRgbComponentPrecision(mode, target.displayProfile);
  if (precision) {
    const outside = colors.filter((color) => !isRgbOnComponentGrid(color, precision));
    if (outside.length > 0) {
      issues.push({
        severity: "error",
        code: "COLOR_OUTSIDE_COMPONENT_GRID",
        message: `${outside.length} visible ${outside.length === 1 ? "color is" : "colors are"} outside the target RGB component grid`,
        rule: "palette.rgbComponentPrecision",
        details: { count: outside.length, precision: { redBits: precision.redBits, greenBits: precision.greenBits, blueBits: precision.blueBits } }
      });
    }
  }
  if ((capability.model === "fixed-indexed" || capability.model === "monochrome") && capability.fixedColors) {
    const fixed = new Set(capability.fixedColors.map(({ r, g, b }) => `${r},${g},${b}`));
    const outside = colors.filter(({ r, g, b }) => !fixed.has(`${r},${g},${b}`));
    if (outside.length > 0) {
      issues.push({
        severity: "error",
        code: "COLOR_OUTSIDE_FIXED_PALETTE",
        message: `${outside.length} visible ${outside.length === 1 ? "color is" : "colors are"} outside the target fixed palette`,
        rule: "palette.fixedColors",
        details: { count: outside.length }
      });
    }
  }
  return issues;
}

function channelRange(colors: RgbColor[], channel: "r" | "g" | "b"): number {
  let min = 255;
  let max = 0;
  for (const color of colors) {
    min = Math.min(min, color[channel]);
    max = Math.max(max, color[channel]);
  }
  return max - min;
}

/** Deterministic median-cut palette generation. */
export function medianCut(image: RgbaImage, maxColors: number): RgbColor[] {
  const unique = new Map<string, RgbColor>();
  for (let i = 0; i < image.width * image.height; i += 1) {
    const color = rgbaColorAt(image, i);
    unique.set(`${color.r},${color.g},${color.b}`, color);
  }
  if (unique.size <= maxColors) return [...unique.values()].map(({ r, g, b }) => ({ r, g, b }));
  const buckets: ColorBucket[] = [{ colors: [...unique.values()] }];
  while (buckets.length < maxColors) {
    buckets.sort((a, b) => {
      const ar = Math.max(channelRange(a.colors, "r"), channelRange(a.colors, "g"), channelRange(a.colors, "b"));
      const br = Math.max(channelRange(b.colors, "r"), channelRange(b.colors, "g"), channelRange(b.colors, "b"));
      return br - ar || b.colors.length - a.colors.length;
    });
    const bucket = buckets.shift();
    if (!bucket || bucket.colors.length < 2) break;
    const ranges = (["r", "g", "b"] as const).map((channel) => ({ channel, range: channelRange(bucket.colors, channel) }));
    ranges.sort((a, b) => b.range - a.range);
    const channel = ranges[0]!.channel;
    bucket.colors.sort((a, b) => a[channel] - b[channel] || a.r - b.r || a.g - b.g || a.b - b.b);
    const middle = Math.ceil(bucket.colors.length / 2);
    buckets.push({ colors: bucket.colors.slice(0, middle) }, { colors: bucket.colors.slice(middle) });
  }
  return buckets.map(({ colors }) => ({
    r: Math.round(colors.reduce((sum, color) => sum + color.r, 0) / colors.length),
    g: Math.round(colors.reduce((sum, color) => sum + color.g, 0) / colors.length),
    b: Math.round(colors.reduce((sum, color) => sum + color.b, 0) / colors.length)
  }));
}

const BAYER_2 = [[0, 2], [3, 1]];
const BAYER_4 = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]];

export function mapToPalette(image: RgbaImage, palette: RgbColor[], dither: ConversionOptions["dither"]): Uint8Array {
  const indices = new Uint8Array(image.width * image.height);
  const work = new Float64Array(image.data.length);
  for (let i = 0; i < image.data.length; i += 1) work[i] = image.data[i]!;
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const pixel = y * image.width + x;
      const offset = pixel * 4;
      let color = { r: work[offset]!, g: work[offset + 1]!, b: work[offset + 2]! };
      if (dither === "bayer2" || dither === "bayer4") {
        const matrix = dither === "bayer2" ? BAYER_2 : BAYER_4;
        const size = matrix.length;
        const value = matrix[y % size]![x % size]!;
        const delta = ((value + 0.5) / (size * size) - 0.5) * 48;
        color = { r: clampByte(color.r + delta), g: clampByte(color.g + delta), b: clampByte(color.b + delta) };
      }
      const selected = nearestColorIndex(color, palette);
      indices[pixel] = selected;
      if (dither === "floyd-steinberg") {
        const actual = palette[selected]!;
        const error = [color.r - actual.r, color.g - actual.g, color.b - actual.b];
        const spread = (nx: number, ny: number, weight: number): void => {
          if (nx < 0 || nx >= image.width || ny >= image.height) return;
          const next = (ny * image.width + nx) * 4;
          for (let channel = 0; channel < 3; channel += 1) work[next + channel] = work[next + channel]! + error[channel]! * weight;
        };
        spread(x + 1, y, 7 / 16);
        spread(x - 1, y + 1, 3 / 16);
        spread(x, y + 1, 5 / 16);
        spread(x + 1, y + 1, 1 / 16);
      }
    }
  }
  return indices;
}

export async function genericConvert(
  image: RgbaImage | RetroImageDocument,
  target: CodecTarget,
  mode: FormatModeDefinition,
  options: ConversionOptions
): Promise<ConversionResult> {
  const prepared = prepareConversionImage(image, mode, options);
  const resized = prepared.image;
  const steps: ConversionStep[] = [...prepared.steps];
  const paletteLimit = mode.colorModel === "ham" ? 1 << (mode.bitsPerPixel - 2)
    : mode.id.includes("ehb") ? Math.ceil(mode.maxColors / 2)
      : Math.min(256, mode.palette?.displayColorLimit ?? mode.maxColors);
  const fixedPalette = mode.palette?.model === "fixed-indexed" || mode.palette?.model === "monochrome"
    ? mode.palette.fixedColors
    : undefined;
  let palette = fixedPalette?.map((color) => ({ ...color })) ?? medianCut(resized, paletteLimit);
  const precision = resolveRgbComponentPrecision(mode, target.displayProfile);
  if (precision) {
    const quantized = palette.map((color) => quantizeRgbToComponentGrid(color, precision));
    const changed = quantized.some((color, index) => color.r !== palette[index]!.r || color.g !== palette[index]!.g || color.b !== palette[index]!.b);
    palette = [...new Map(quantized.map((color) => [`${color.r},${color.g},${color.b}`, color])).values()];
    if (changed) steps.push({ operation: "hardware-quantize", message: "Quantized colors to the target RGB component grid without dithering" });
  }
  const indices = mapToPalette(resized, palette, options.dither ?? "none");
  const preview = indexedToRgba(indices, resized.width, resized.height, palette);
  const document: RasterDocument = {
    kind: "raster",
    formatId: target.formatId,
    modeId: target.modeId,
    width: resized.width,
    height: resized.height,
    pixelAspect: mode.pixelAspect,
    displayProfile: target.displayProfile,
    palette,
    preview,
    indices,
    components: {},
    metadata: {},
    warnings: [],
    preserved: []
  };
  steps.push({ operation: "palette", message: `Reduced to ${palette.length} colors` });
  if ((options.dither ?? "none") !== "none") steps.push({ operation: "dither", message: `Applied ${options.dither}` });
  return { document, report: { target, steps, warnings: [] } };
}

export function paletteError(image: RgbaImage, palette: RgbColor[]): number {
  let sum = 0;
  for (let i = 0; i < image.width * image.height; i += 1) {
    const color = rgbaColorAt(image, i);
    sum += colorDistance(color, palette[nearestColorIndex(color, palette)]!);
  }
  return sum;
}
