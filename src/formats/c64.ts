import { extensionOf } from "../core/binary";
import { indexedToRgba, nearestColorIndex, rgbaColorAt } from "../core/color";
import { genericConvert, imagePreview, prepareConversionImage } from "../core/conversion";
import { RetroImageError } from "../core/errors";
import type {
  AnalysisIssue,
  C64ColorMatchResult,
  C64ColorMatchSample,
  C64ConversionOptions,
  CodecTarget,
  ConversionOptions,
  ConversionResult,
  DecodeOptions,
  EncodeOptions,
  EncodeResult,
  FormatDefinition,
  FormatModeDefinition,
  FormatPlugin,
  RasterDocument,
  RetroImageDocument,
  RgbColor,
  RgbaImage
} from "../core/types";
import { modeAnalysis, rasterDocument } from "./common";

/** Canonical PAL-oriented C64 palette; native color codes remain unchanged. */
export const c64Palette: RgbColor[] = [
  { r: 0, g: 0, b: 0 }, { r: 255, g: 255, b: 255 }, { r: 129, g: 51, b: 56 }, { r: 117, g: 206, b: 200 },
  { r: 142, g: 60, b: 151 }, { r: 86, g: 172, b: 77 }, { r: 46, g: 44, b: 155 }, { r: 237, g: 241, b: 113 },
  { r: 142, g: 80, b: 41 }, { r: 85, g: 56, b: 0 }, { r: 196, g: 108, b: 113 }, { r: 74, g: 74, b: 74 },
  { r: 123, g: 123, b: 123 }, { r: 169, g: 255, b: 159 }, { r: 112, g: 109, b: 235 }, { r: 178, g: 178, b: 178 }
];

function validateDisplayPalette(displayPalette: RgbColor[]): void {
  if (displayPalette.length !== 16) throw new RetroImageError("INVALID_OPTION", "C64 displayPalette must contain exactly 16 colors");
}

function validateColorCode(colorCode: number, label: string): void {
  if (!Number.isInteger(colorCode) || colorCode < 0 || colorCode > 15) throw new RetroImageError("INVALID_OPTION", `${label} must be a C64 color code from 0 through 15`);
}

function linearSrgb(component: number): number {
  const value = Math.max(0, Math.min(255, component)) / 255;
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

function oklab(color: RgbColor): [number, number, number] {
  const red = linearSrgb(color.r), green = linearSrgb(color.g), blue = linearSrgb(color.b);
  const l = Math.cbrt(0.4122214708 * red + 0.5363325363 * green + 0.0514459929 * blue);
  const m = Math.cbrt(0.2119034982 * red + 0.6806995451 * green + 0.1073969566 * blue);
  const s = Math.cbrt(0.0883024619 * red + 0.2817188376 * green + 0.6299787005 * blue);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}

function oklabDistanceSquared(left: RgbColor, right: RgbColor): number {
  const a = oklab(left), b = oklab(right);
  return (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
}

/** Match RGB samples to native VIC-II color codes using weighted OKLab distance. */
export function matchC64ColorCodes(samples: C64ColorMatchSample[], displayPalette: RgbColor[]): C64ColorMatchResult {
  validateDisplayPalette(displayPalette);
  let weightedDistance = 0;
  let totalWeight = 0;
  const matches = samples.map(({ color, weight = 1, pinnedColorCode }) => {
    if (!Number.isFinite(weight) || weight < 0) throw new RetroImageError("INVALID_OPTION", "C64 match sample weights must be finite and non-negative");
    const pinned = pinnedColorCode !== undefined;
    if (pinned) validateColorCode(pinnedColorCode, "pinnedColorCode");
    let colorCode = pinnedColorCode ?? 0;
    let distance = Number.POSITIVE_INFINITY;
    if (pinned) distance = oklabDistanceSquared(color, displayPalette[colorCode]!);
    else for (let code = 0; code < displayPalette.length; code += 1) {
      const next = oklabDistanceSquared(color, displayPalette[code]!);
      if (next < distance) {
        distance = next;
        colorCode = code;
      }
    }
    weightedDistance += weight * distance;
    totalWeight += weight;
    return { colorCode, distance, pinned };
  });
  if (samples.length > 0 && totalWeight === 0) throw new RetroImageError("INVALID_OPTION", "C64 match samples must have a positive total weight");
  return { matches, weightedMeanDistance: totalWeight === 0 ? 0 : weightedDistance / totalWeight };
}

function colorKey({ r, g, b }: RgbColor): string {
  return `${r},${g},${b}`;
}

interface NativeC64Codes {
  indices: Uint8Array;
  pinnedCodes: Uint8Array;
  report: C64ColorMatchResult;
  entries: Array<{ sourceColor: RgbColor; colorCode: number; distance: number; pinned: boolean }>;
}

function mapNativeC64Codes(image: RgbaImage, options: C64ConversionOptions): NativeC64Codes {
  validateDisplayPalette(options.displayPalette);
  const sourceColorCodes = new Map<string, { colorCode: number; pinned: boolean }>();
  for (const source of options.sourceColorCodes ?? []) {
    validateColorCode(source.colorCode, "sourceColorCodes.colorCode");
    const key = colorKey(source.sourceColor);
    if (sourceColorCodes.has(key)) throw new RetroImageError("INVALID_OPTION", "sourceColorCodes must not map one RGB color more than once");
    sourceColorCodes.set(key, { colorCode: source.colorCode, pinned: source.pinned ?? false });
  }
  const assignments = new Map<string, { sourceColor: RgbColor; colorCode: number; distance: number; pinned: boolean }>();
  for (let pixel = 0; pixel < image.width * image.height; pixel += 1) {
    const color = rgbaColorAt(image, pixel);
    const key = colorKey(color);
    if (assignments.has(key)) continue;
    const source = sourceColorCodes.get(key);
    if (source) {
      assignments.set(key, { sourceColor: { r: color.r, g: color.g, b: color.b }, colorCode: source.colorCode, distance: oklabDistanceSquared(color, options.displayPalette[source.colorCode]!), pinned: source.pinned });
    } else {
      assignments.set(key, { sourceColor: { r: color.r, g: color.g, b: color.b }, ...matchC64ColorCodes([{ color }], options.displayPalette).matches[0]! });
    }
  }
  const indices = new Uint8Array(image.width * image.height);
  const pinnedCodes = new Uint8Array(indices.length).fill(255);
  let weightedDistance = 0;
  for (let pixel = 0; pixel < indices.length; pixel += 1) {
    const assignment = assignments.get(colorKey(rgbaColorAt(image, pixel)))!;
    indices[pixel] = assignment.colorCode;
    if (assignment.pinned) pinnedCodes[pixel] = assignment.colorCode;
    weightedDistance += assignment.distance;
  }
  const entries = [...assignments.values()];
  return { indices, pinnedCodes, report: { matches: entries.map(({ colorCode, distance, pinned }) => ({ colorCode, distance, pinned })), weightedMeanDistance: weightedDistance / indices.length }, entries };
}

function nativeRaster(image: RgbaImage, target: CodecTarget, mode: FormatModeDefinition, options: C64ConversionOptions): { document: RasterDocument; report: C64ColorMatchResult; entries: NativeC64Codes["entries"] } {
  const mapped = mapNativeC64Codes(image, options);
  return {
    document: {
      kind: "raster", formatId: target.formatId, modeId: target.modeId, width: image.width, height: image.height, pixelAspect: mode.pixelAspect,
      displayProfile: target.displayProfile, palette: options.displayPalette.map((color) => ({ ...color })), indices: mapped.indices,
      preview: indexedToRgba(mapped.indices, image.width, image.height, options.displayPalette), components: { c64PinnedCodes: mapped.pinnedCodes },
      metadata: { c64NativeColorCodes: true }, warnings: [], preserved: []
    },
    report: mapped.report,
    entries: mapped.entries
  };
}

function nativeCodes(document: RetroImageDocument): Uint8Array | undefined {
  return document.kind === "raster" && document.metadata.c64NativeColorCodes === true ? document.indices : undefined;
}

function pinnedCodes(document: RetroImageDocument): Uint8Array | undefined {
  return document.kind === "raster" && document.metadata.c64NativeColorCodes === true ? document.components.c64PinnedCodes : undefined;
}

function nativeRasterForTarget(source: RasterDocument, target: CodecTarget, mode: FormatModeDefinition, options: C64ConversionOptions): { document: RasterDocument; entries: NativeC64Codes["entries"] } {
  validateDisplayPalette(options.displayPalette);
  const targetSize = mode.dimensions[0];
  if (!targetSize || source.width !== targetSize.width || source.height !== targetSize.height) {
    throw new RetroImageError("VALIDATION_FAILED", "Configured native C64 raster resize is not supported; use matching target dimensions");
  }
  const pins = pinnedCodes(source);
  const pinByCode = new Set<number>();
  if (pins) for (let pixel = 0; pixel < pins.length; pixel += 1) if (pins[pixel] !== 255) pinByCode.add(source.indices[pixel]!);
  const usedCodes = [...new Set(source.indices)].sort((a, b) => a - b);
  const sourcePalette = source.palette.length === 16 ? source.palette : c64Palette;
  return {
    document: {
      ...source,
      formatId: target.formatId,
      modeId: target.modeId,
      pixelAspect: mode.pixelAspect,
      displayProfile: target.displayProfile,
      palette: options.displayPalette.map((color) => ({ ...color })),
      preview: indexedToRgba(source.indices, source.width, source.height, options.displayPalette),
      metadata: { ...source.metadata, c64NativeColorCodes: true }
    },
    entries: usedCodes.map((colorCode) => ({ sourceColor: { ...sourcePalette[colorCode]! }, colorCode, distance: 0, pinned: pinByCode.has(colorCode) }))
  };
}

const hiresMode: FormatModeDefinition = {
  id: "hires-bitmap", label: "Hires bitmap", dimensions: [{ width: 320, height: 200 }], pixelAspect: { numerator: 1, denominator: 1 },
  colorModel: "indexed", bitsPerPixel: 1, maxColors: 16, cell: { width: 8, height: 8, maxColors: 2 }, hardwareProfiles: ["vic-ii"],
  videoStandards: ["pal", "ntsc"], supportsTransparency: false,
  palette: { model: "structured-registers", displayColorLimit: 16, storableColorEntries: 16, fixedColors: c64Palette, registers: [{ id: "vic-color-codes", count: 16, valueModel: "fixed-color-code" }] },
  resolutionClass: "low", interlaceSupport: "none",
  displayVariants: (["pal", "ntsc"] as const).map((videoStandard) => ({ id: videoStandard, label: videoStandard.toUpperCase(), hardwareProfiles: ["vic-ii"], videoStandard, nominalPageSize: { width: 320, height: 200 }, pixelAspect: { numerator: 1, denominator: 1 }, interlaced: false }))
};
const multicolorMode: FormatModeDefinition = {
  id: "multicolor-bitmap", label: "Multicolor bitmap", dimensions: [{ width: 160, height: 200 }], pixelAspect: { numerator: 2, denominator: 1 },
  colorModel: "indexed", bitsPerPixel: 2, maxColors: 16, cell: { width: 4, height: 8, maxColors: 4, sharedColors: 1 }, hardwareProfiles: ["vic-ii"],
  videoStandards: ["pal", "ntsc"], supportsTransparency: false,
  palette: { model: "structured-registers", displayColorLimit: 16, storableColorEntries: 16, fixedColors: c64Palette, registers: [{ id: "vic-color-codes", count: 16, valueModel: "fixed-color-code" }] },
  resolutionClass: "low", interlaceSupport: "none",
  displayVariants: (["pal", "ntsc"] as const).map((videoStandard) => ({ id: videoStandard, label: videoStandard.toUpperCase(), hardwareProfiles: ["vic-ii"], videoStandard, nominalPageSize: { width: 160, height: 200 }, pixelAspect: { numerator: 2, denominator: 1 }, interlaced: false }))
};

function definition(id: string, label: string, extensions: string[], mode: FormatModeDefinition, raw = false): FormatDefinition {
  return { schemaVersion: 1, id, label, platform: "Commodore 64", extensions, mimeTypes: ["application/x-c64-image"], canDecode: true, canEncode: true, raw, modes: [mode] };
}

const koalaDefinition = definition("c64.koala", "C64 Koala Painter", ["koa", "kla"], multicolorMode);
const artDefinition = definition("c64.art-studio", "C64 Art Studio", ["art"], hiresMode);
const doodleDefinition = definition("c64.doodle", "C64 Doodle", ["dd"], hiresMode);
const rawModes: FormatModeDefinition[] = [
  hiresMode,
  multicolorMode,
  { ...hiresMode, id: "standard-char", label: "Standard character screen", colorModel: "character" },
  { ...multicolorMode, id: "multicolor-char", label: "Multicolor character screen", colorModel: "character", cell: { width: 4, height: 8, maxColors: 4, sharedColors: 3 } },
  { ...hiresMode, id: "extended-background-char", label: "Extended background character screen", colorModel: "character", cell: { width: 8, height: 8, maxColors: 2, sharedColors: 4 } }
];
const rawDefinition: FormatDefinition = { schemaVersion: 1, id: "c64.raw", label: "C64 raw graphics memory", platform: "Commodore 64", extensions: ["bin", "raw", "chr"], mimeTypes: ["application/octet-stream"], canDecode: true, canEncode: true, raw: true, modes: rawModes };

function profile(options: DecodeOptions) {
  return options.displayProfile ?? { hardware: "vic-ii", videoStandard: "pal" as const, paletteId: "c64-canonical-pal" };
}

function decodeHires(bitmap: Uint8Array, screen: Uint8Array, formatId: string, options: DecodeOptions, extra: Record<string, Uint8Array> = {}): RasterDocument {
  if (bitmap.length < 8000 || screen.length < 1000) throw new RetroImageError("INVALID_FILE", "C64 hires data requires 8000 bitmap and 1000 screen bytes");
  const indices = new Uint8Array(320 * 200);
  for (let cy = 0; cy < 25; cy += 1) for (let cx = 0; cx < 40; cx += 1) {
    const colors = screen[cy * 40 + cx]!;
    const foreground = colors >>> 4;
    const background = colors & 0xf;
    for (let row = 0; row < 8; row += 1) {
      const bits = bitmap[(cy * 40 + cx) * 8 + row]!;
      for (let x = 0; x < 8; x += 1) indices[(cy * 8 + row) * 320 + cx * 8 + x] = bits & (0x80 >>> x) ? foreground : background;
    }
  }
  return rasterDocument({ formatId, modeId: "hires-bitmap", width: 320, height: 200, pixelAspect: hiresMode.pixelAspect, displayProfile: profile(options), palette: options.palette ?? c64Palette, indices, components: { bitmap: bitmap.slice(0, 8000), screen: screen.slice(0, 1000), ...extra }, metadata: { c64NativeColorCodes: true }, warnings: options.displayProfile ? [] : [{ code: "ASSUMED_DISPLAY_PROFILE", message: "Used the canonical C64 PAL display profile" }], preserved: [] });
}

function decodeMulticolor(bitmap: Uint8Array, screen: Uint8Array, colorRam: Uint8Array, background: number, formatId: string, options: DecodeOptions): RasterDocument {
  if (bitmap.length < 8000 || screen.length < 1000 || colorRam.length < 1000) throw new RetroImageError("INVALID_FILE", "C64 multicolor data is truncated");
  const indices = new Uint8Array(160 * 200);
  for (let cy = 0; cy < 25; cy += 1) for (let cx = 0; cx < 40; cx += 1) {
    const screenColor = screen[cy * 40 + cx]!;
    const colors = [background & 0xf, screenColor >>> 4, screenColor & 0xf, colorRam[cy * 40 + cx]! & 0xf];
    for (let row = 0; row < 8; row += 1) {
      const bits = bitmap[(cy * 40 + cx) * 8 + row]!;
      for (let x = 0; x < 4; x += 1) indices[(cy * 8 + row) * 160 + cx * 4 + x] = colors[(bits >>> (6 - x * 2)) & 3]!;
    }
  }
  return rasterDocument({ formatId, modeId: "multicolor-bitmap", width: 160, height: 200, pixelAspect: multicolorMode.pixelAspect, displayProfile: profile(options), palette: options.palette ?? c64Palette, indices, components: { bitmap: bitmap.slice(0, 8000), screen: screen.slice(0, 1000), colorRam: colorRam.slice(0, 1000), background: Uint8Array.of(background & 0xf) }, metadata: { background: background & 0xf, c64NativeColorCodes: true }, warnings: options.displayProfile ? [] : [{ code: "ASSUMED_DISPLAY_PROFILE", message: "Used the canonical C64 PAL display profile" }], preserved: [] });
}

function loadPayload(data: Uint8Array, address: number, allowedLengths: number[]): Uint8Array {
  const hasHeader = allowedLengths.includes(data.length) && data.length >= 2 && (data[0]! | (data[1]! << 8)) === address;
  return hasHeader ? data.subarray(2) : data;
}

function formatIssues(image: RgbaImage | RetroImageDocument, target: CodecTarget, mode: FormatModeDefinition) {
  const preview = imagePreview(image);
  const native = "kind" in image ? nativeCodes(image) : undefined;
  const issues: AnalysisIssue[] = [];
  if (mode.cell && mode.dimensions.some(({ width, height }) => width === preview.width && height === preview.height)) {
    for (let cy = 0; cy < 25; cy += 1) for (let cx = 0; cx < 40; cx += 1) {
      const colors = new Set<number>();
      for (let y = 0; y < mode.cell.height; y += 1) for (let x = 0; x < mode.cell.width; x += 1) {
        const pixel = (cy * mode.cell.height + y) * preview.width + cx * mode.cell.width + x;
        colors.add(native?.[pixel] ?? nearestColorIndex({ r: preview.data[pixel * 4]!, g: preview.data[pixel * 4 + 1]!, b: preview.data[pixel * 4 + 2]! }, c64Palette));
      }
      if (colors.size > mode.cell.maxColors) issues.push({ severity: "error", code: "C64_CELL_COLORS", message: `Cell ${cx},${cy} has ${colors.size} colors`, rule: "cell.maxColors", details: { x: cx, y: cy, colors: colors.size } });
    }
  }
  return modeAnalysis(image, target, mode, issues);
}

function cellColors(preview: RgbaImage, cx: number, cy: number, logicalCellWidth: number, max: number, forced?: number): number[] {
  const counts = new Map<number, number>();
  for (let y = 0; y < 8; y += 1) for (let x = 0; x < logicalCellWidth; x += 1) {
    const pixel = (cy * 8 + y) * preview.width + cx * logicalCellWidth + x;
    const color = nearestColorIndex({ r: preview.data[pixel * 4]!, g: preview.data[pixel * 4 + 1]!, b: preview.data[pixel * 4 + 2]! }, c64Palette);
    counts.set(color, (counts.get(color) ?? 0) + 1);
  }
  const result = [...counts].sort((a, b) => b[1] - a[1] || a[0] - b[0]).map(([color]) => color);
  if (forced !== undefined) return [forced, ...result.filter((color) => color !== forced)].slice(0, max);
  return result.slice(0, max);
}

function nativeCellColors(indices: Uint8Array, width: number, cx: number, cy: number, logicalCellWidth: number): number[] {
  const counts = new Map<number, number>();
  for (let y = 0; y < 8; y += 1) for (let x = 0; x < logicalCellWidth; x += 1) {
    const code = indices[(cy * 8 + y) * width + cx * logicalCellWidth + x]!;
    counts.set(code, (counts.get(code) ?? 0) + 1);
  }
  return [...counts].sort((a, b) => b[1] - a[1] || a[0] - b[0]).map(([code]) => code);
}

function nativePinnedCodes(indices: Uint8Array, pins: Uint8Array | undefined, width: number, cx: number, cy: number, logicalCellWidth: number): number[] {
  if (!pins) return [];
  const codes = new Set<number>();
  for (let y = 0; y < 8; y += 1) for (let x = 0; x < logicalCellWidth; x += 1) {
    const pixel = (cy * 8 + y) * width + cx * logicalCellWidth + x;
    if (pins[pixel] !== 255) codes.add(indices[pixel]!);
  }
  return [...codes].sort((a, b) => a - b);
}

function nativeConstraintError(cx: number, cy: number, codes: number[], maximum: number, background?: number): never {
  throw new RetroImageError("VALIDATION_FAILED", `C64 cell ${cx},${cy} has incompatible pinned native color codes`, {
    x: cx, y: cy, codes, maximum, ...(background === undefined ? {} : { background })
  });
}

function selectedNativeColor(document: RetroImageDocument, pixel: number, colors: number[]): number {
  const indices = nativeCodes(document)!;
  const wanted = indices[pixel]!;
  const direct = colors.indexOf(wanted);
  if (direct >= 0) return direct;
  const palette = document.palette.length === 16 ? document.palette : c64Palette;
  return nearestColorIndex(palette[wanted]!, colors.map((code) => palette[code]!));
}

function nativeKoalaBackground(document: RetroImageDocument): number {
  const indices = nativeCodes(document)!;
  const pins = pinnedCodes(document);
  const totals = new Map<number, number>();
  for (const code of indices) totals.set(code, (totals.get(code) ?? 0) + 1);
  const candidates = Array.from({ length: 16 }, (_, code) => code).sort((a, b) => (totals.get(b) ?? 0) - (totals.get(a) ?? 0) || a - b);
  for (const background of candidates) {
    let valid = true;
    for (let cy = 0; cy < 25 && valid; cy += 1) for (let cx = 0; cx < 40; cx += 1) {
      if (nativePinnedCodes(indices, pins, 160, cx, cy, 4).filter((code) => code !== background).length > 3) valid = false;
    }
    if (valid) return background;
  }
  for (let cy = 0; cy < 25; cy += 1) for (let cx = 0; cx < 40; cx += 1) {
    const codes = nativePinnedCodes(indices, pins, 160, cx, cy, 4);
    if (codes.length >= 4) nativeConstraintError(cx, cy, codes, 3);
  }
  throw new RetroImageError("VALIDATION_FAILED", "C64 multicolor background cannot satisfy pinned native color codes");
}

function encodeHires(document: RetroImageDocument, layout: "art" | "doodle" | "raw"): Uint8Array {
  const preview = document.preview;
  if (preview.width !== 320 || preview.height !== 200) throw new RetroImageError("VALIDATION_FAILED", "C64 hires output must be 320x200");
  const native = nativeCodes(document);
  const pins = pinnedCodes(document);
  const bitmap = new Uint8Array(8000);
  const screen = new Uint8Array(1000);
  for (let cy = 0; cy < 25; cy += 1) for (let cx = 0; cx < 40; cx += 1) {
    const pinned = native ? nativePinnedCodes(native, pins, 320, cx, cy, 8) : [];
    if (pinned.length > 2) nativeConstraintError(cx, cy, pinned, 2);
    const colors = native ? [...pinned, ...nativeCellColors(native, 320, cx, cy, 8).filter((code) => !pinned.includes(code))].slice(0, 2) : cellColors(preview, cx, cy, 8, 2);
    const background = colors[0] ?? 0;
    const foreground = colors[1] ?? background;
    screen[cy * 40 + cx] = (foreground << 4) | background;
    for (let row = 0; row < 8; row += 1) {
      let bits = 0;
      for (let x = 0; x < 8; x += 1) {
        const pixel = ((cy * 8 + row) * 320 + cx * 8 + x) * 4;
        const selected = native ? selectedNativeColor(document, (cy * 8 + row) * 320 + cx * 8 + x, [background, foreground]) : nearestColorIndex({ r: preview.data[pixel]!, g: preview.data[pixel + 1]!, b: preview.data[pixel + 2]! }, [c64Palette[background]!, c64Palette[foreground]!]);
        if (selected === 1) bits |= 0x80 >>> x;
      }
      bitmap[(cy * 40 + cx) * 8 + row] = bits;
    }
  }
  if (layout === "raw") return bitmap;
  if (layout === "doodle") {
    const output = new Uint8Array(9218);
    output.set([0x00, 0x5c]); output.set(screen, 2); output.set(bitmap, 2 + 1024);
    return output;
  }
  const output = new Uint8Array(9009);
  output.set([0x00, 0x20]); output.set(bitmap, 2); output.set(screen, 8002);
  return output;
}

function encodeKoala(document: RetroImageDocument): Uint8Array {
  const preview = document.preview;
  if (preview.width !== 160 || preview.height !== 200) throw new RetroImageError("VALIDATION_FAILED", "Koala output must be 160x200 logical pixels");
  const native = nativeCodes(document);
  const pins = pinnedCodes(document);
  const globalCounts = new Map<number, number>();
  for (let i = 0; !native && i < preview.width * preview.height; i += 1) {
    const color = nearestColorIndex({ r: preview.data[i * 4]!, g: preview.data[i * 4 + 1]!, b: preview.data[i * 4 + 2]! }, c64Palette);
    globalCounts.set(color, (globalCounts.get(color) ?? 0) + 1);
  }
  const background = native ? nativeKoalaBackground(document) : [...globalCounts].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0] ?? 0;
  const bitmap = new Uint8Array(8000), screen = new Uint8Array(1000), colorRam = new Uint8Array(1000);
  for (let cy = 0; cy < 25; cy += 1) for (let cx = 0; cx < 40; cx += 1) {
    const pinned = native ? nativePinnedCodes(native, pins, 160, cx, cy, 4).filter((code) => code !== background) : [];
    if (pinned.length > 3) nativeConstraintError(cx, cy, pinned, 3, background);
    const colors = native ? [background, ...pinned, ...nativeCellColors(native, 160, cx, cy, 4).filter((code) => code !== background && !pinned.includes(code))].slice(0, 4) : cellColors(preview, cx, cy, 4, 4, background);
    while (colors.length < 4) colors.push(colors.at(-1) ?? background);
    screen[cy * 40 + cx] = (colors[1]! << 4) | colors[2]!;
    colorRam[cy * 40 + cx] = colors[3]!;
    for (let row = 0; row < 8; row += 1) {
      let bits = 0;
      for (let x = 0; x < 4; x += 1) {
        const pixel = ((cy * 8 + row) * 160 + cx * 4 + x) * 4;
        const selected = native ? selectedNativeColor(document, (cy * 8 + row) * 160 + cx * 4 + x, colors) : nearestColorIndex({ r: preview.data[pixel]!, g: preview.data[pixel + 1]!, b: preview.data[pixel + 2]! }, colors.map((color) => c64Palette[color]!));
        bits |= selected << (6 - x * 2);
      }
      bitmap[(cy * 40 + cx) * 8 + row] = bits;
    }
  }
  const output = new Uint8Array(10003);
  output.set([0x00, 0x60]); output.set(bitmap, 2); output.set(screen, 8002); output.set(colorRam, 9002); output[10002] = background;
  return output;
}

function convertNativeC64(
  image: RgbaImage | RetroImageDocument,
  target: CodecTarget,
  mode: FormatModeDefinition,
  options: ConversionOptions,
  encode: (document: RetroImageDocument) => Uint8Array,
  decode: (data: Uint8Array, palette: RgbColor[]) => RasterDocument,
  cellMessage: string
): ConversionResult {
  const sourceNative = "kind" in image && image.kind === "raster" && nativeCodes(image) ? image : undefined;
  const prepared = sourceNative ? undefined : prepareConversionImage(image, mode, options);
  let documentToEncode: RasterDocument;
  let entries: NativeC64Codes["entries"];
  let weightedMeanDistance: number;
  if (sourceNative) {
    const mapped = nativeRasterForTarget(sourceNative, target, mode, options.c64!);
    documentToEncode = mapped.document;
    entries = mapped.entries;
    weightedMeanDistance = 0;
  } else {
    const mapped = nativeRaster(prepared!.image, target, mode, options.c64!);
    documentToEncode = mapped.document;
    entries = mapped.entries;
    weightedMeanDistance = mapped.report.weightedMeanDistance;
  }
  const reportEntries = entries.map(({ sourceColor, colorCode, distance, pinned }) => ({
    sourceColor: { r: sourceColor.r, g: sourceColor.g, b: sourceColor.b }, colorCode, distance, pinned
  }));
  const output = encode(documentToEncode);
  const document = decode(output, options.c64!.displayPalette);
  return {
    document,
    report: {
      target,
      steps: [
        ...(prepared?.steps ?? []),
        {
          operation: "c64-color-code-map",
          message: "Mapped source RGB colors to native VIC-II color codes",
          details: {
            weightedMeanDistance,
            matches: reportEntries
          }
        },
        { operation: "c64-cells", message: cellMessage }
      ],
      warnings: []
    }
  };
}

export const c64KoalaPlugin: FormatPlugin = {
  definition: koalaDefinition,
  probe(data, context) {
    const valid = data.length === 10003 && data[0] === 0 && data[1] === 0x60;
    if (!valid) return null;
    return { formatId: koalaDefinition.id, confidence: extensionOf(context.filename) === "koa" || extensionOf(context.filename) === "kla" ? 1 : 0.9, reason: "Koala load address and 10003-byte layout" };
  },
  async decode(data, options) { const p = loadPayload(data, 0x6000, [10003]); return decodeMulticolor(p.subarray(0, 8000), p.subarray(8000, 9000), p.subarray(9000, 10000), p[10000]!, koalaDefinition.id, options); },
  async encode(document): Promise<EncodeResult> { return { data: encodeKoala(document), formatId: koalaDefinition.id, warnings: [] }; },
  analyze(image, target) { return formatIssues(image, target, multicolorMode); },
  async convert(image, target, options) {
    if (options.c64) return convertNativeC64(image, target, multicolorMode, options, encodeKoala, (output, palette) => {
      const payload = output.subarray(2);
      return decodeMulticolor(payload.subarray(0, 8000), payload.subarray(8000, 9000), payload.subarray(9000, 10000), payload[10000]!, koalaDefinition.id, { displayProfile: target.displayProfile, palette });
    }, "Optimized four VIC-II colors per multicolor cell with one shared background");
    const converted = await genericConvert(image, target, multicolorMode, options);
    const output = encodeKoala(converted.document);
    const p = output.subarray(2);
    const document = decodeMulticolor(p.subarray(0, 8000), p.subarray(8000, 9000), p.subarray(9000, 10000), p[10000]!, koalaDefinition.id, { displayProfile: target.displayProfile });
    converted.report.steps.push({ operation: "c64-cells", message: "Optimized four VIC-II colors per multicolor cell with one shared background" });
    return { document, report: converted.report };
  }
};

export const c64ArtStudioPlugin: FormatPlugin = {
  definition: artDefinition,
  probe(data, context) {
    const valid = (data.length === 9009 || data.length === 9002) && data[0] === 0 && data[1] === 0x20;
    if (!valid) return null;
    return { formatId: artDefinition.id, confidence: extensionOf(context.filename) === "art" ? 1 : 0.85, reason: "Art Studio load address and bitmap layout" };
  },
  async decode(data, options) { const p = data.subarray(2); return decodeHires(p.subarray(0, 8000), p.subarray(8000, 9000), artDefinition.id, options, { trailer: p.slice(9000) }); },
  async encode(document): Promise<EncodeResult> { return { data: encodeHires(document, "art"), formatId: artDefinition.id, warnings: [] }; },
  analyze(image, target) { return formatIssues(image, target, hiresMode); },
  async convert(image, target, options) {
    if (options.c64) return convertNativeC64(image, target, hiresMode, options, (document) => encodeHires(document, "art"), (output, palette) => {
      const payload = output.subarray(2);
      return decodeHires(payload.subarray(0, 8000), payload.subarray(8000, 9000), artDefinition.id, { displayProfile: target.displayProfile, palette });
    }, "Optimized two VIC-II colors per hires cell");
    const converted = await genericConvert(image, target, hiresMode, options);
    const output = encodeHires(converted.document, "art");
    const p = output.subarray(2);
    const document = decodeHires(p.subarray(0, 8000), p.subarray(8000, 9000), artDefinition.id, { displayProfile: target.displayProfile });
    converted.report.steps.push({ operation: "c64-cells", message: "Optimized two VIC-II colors per hires cell" });
    return { document, report: converted.report };
  }
};

export const c64DoodlePlugin: FormatPlugin = {
  definition: doodleDefinition,
  probe(data, context) {
    const valid = data.length === 9218 && data[0] === 0 && data[1] === 0x5c;
    if (!valid) return null;
    return { formatId: doodleDefinition.id, confidence: extensionOf(context.filename) === "dd" ? 1 : 0.9, reason: "Doodle load address and 9218-byte layout" };
  },
  async decode(data, options) { const p = data.subarray(2); return decodeHires(p.subarray(1024, 9024), p.subarray(0, 1000), doodleDefinition.id, options, { padding: p.slice(1000, 1024), trailer: p.slice(9024) }); },
  async encode(document): Promise<EncodeResult> { return { data: encodeHires(document, "doodle"), formatId: doodleDefinition.id, warnings: [] }; },
  analyze(image, target) { return formatIssues(image, target, hiresMode); },
  async convert(image, target, options) {
    if (options.c64) return convertNativeC64(image, target, hiresMode, options, (document) => encodeHires(document, "doodle"), (output, palette) => {
      const payload = output.subarray(2);
      return decodeHires(payload.subarray(1024, 9024), payload.subarray(0, 1000), doodleDefinition.id, { displayProfile: target.displayProfile, palette });
    }, "Optimized two VIC-II colors per Doodle cell");
    const converted = await genericConvert(image, target, hiresMode, options);
    const output = encodeHires(converted.document, "doodle");
    const p = output.subarray(2);
    const document = decodeHires(p.subarray(1024, 9024), p.subarray(0, 1000), doodleDefinition.id, { displayProfile: target.displayProfile });
    converted.report.steps.push({ operation: "c64-cells", message: "Optimized two VIC-II colors per Doodle cell" });
    return { document, report: converted.report };
  }
};

function decodeCharset(data: Uint8Array, options: DecodeOptions): RetroImageDocument {
  const modeId = options.modeId;
  if (!modeId) throw new RetroImageError("MISSING_HINT", "C64 raw decode requires modeId");
  const mode = rawModes.find(({ id }) => id === modeId);
  if (!mode) throw new RetroImageError("UNSUPPORTED_MODE", `Unknown C64 raw mode ${modeId}`);
  if (modeId === "hires-bitmap") {
    const screen = options.components?.screen;
    if (!screen) throw new RetroImageError("MISSING_HINT", "Raw hires bitmap requires components.screen");
    return decodeHires(data, screen, rawDefinition.id, options);
  }
  if (modeId === "multicolor-bitmap") {
    const screen = options.components?.screen, colorRam = options.components?.colorRam;
    if (!screen || !colorRam) throw new RetroImageError("MISSING_HINT", "Raw multicolor bitmap requires screen and colorRam components");
    return decodeMulticolor(data, screen, colorRam, options.components?.background?.[0] ?? 0, rawDefinition.id, options);
  }
  const charset = options.components?.charset ?? data;
  if (charset.length < 512) throw new RetroImageError("INVALID_FILE", "C64 charset must contain at least 64 glyphs");
  const glyphCount = Math.min(256, Math.floor(charset.length / 8));
  const screen = options.components?.screen;
  const colorRam = options.components?.colorRam;
  const width = screen ? (modeId === "multicolor-char" ? 160 : 320) : (modeId === "multicolor-char" ? 64 : 128);
  const height = screen ? 200 : Math.ceil(glyphCount / 16) * 8;
  const indices = new Uint8Array(width * height);
  const renderCell = (cellX: number, cellY: number, code: number, color: number): void => {
    const glyph = modeId === "extended-background-char" ? code & 0x3f : code;
    const background = modeId === "extended-background-char" ? options.components?.backgrounds?.[code >>> 6] ?? 0 : options.components?.background?.[0] ?? 0;
    for (let row = 0; row < 8; row += 1) {
      const bits = charset[glyph * 8 + row] ?? 0;
      const logicalWidth = modeId === "multicolor-char" ? 4 : 8;
      for (let x = 0; x < logicalWidth; x += 1) {
        const value = modeId === "multicolor-char" ? (bits >>> (6 - x * 2)) & 3 : bits & (0x80 >>> x) ? 1 : 0;
        const paletteCode = modeId === "multicolor-char" ? [background, options.components?.backgrounds?.[0] ?? 0, options.components?.backgrounds?.[1] ?? 0, color & 7][value]! : value ? color & 0xf : background;
        const px = modeId === "multicolor-char" ? (cellX * 4 + x) : (cellX * 8 + x);
        indices[(cellY * 8 + row) * width + px] = paletteCode;
      }
    }
  };
  if (screen) for (let i = 0; i < Math.min(1000, screen.length); i += 1) renderCell(i % 40, Math.floor(i / 40), screen[i]!, colorRam?.[i] ?? 1);
  else for (let i = 0; i < glyphCount; i += 1) renderCell(i % 16, Math.floor(i / 16), i, 1);
  const renderWidth = width;
  return {
    kind: "charset", formatId: rawDefinition.id, modeId, width: renderWidth, height, pixelAspect: mode.pixelAspect, displayProfile: profile(options), palette: options.palette ?? c64Palette,
    preview: indexedToRgba(indices, renderWidth, height, options.palette ?? c64Palette), components: { charset: charset.slice(), ...(screen ? { screen: screen.slice() } : {}), ...(colorRam ? { colorRam: colorRam.slice() } : {}) },
    metadata: {}, warnings: options.displayProfile ? [] : [{ code: "ASSUMED_DISPLAY_PROFILE", message: "Used the canonical C64 PAL display profile" }], preserved: [], glyphWidth: modeId === "multicolor-char" ? 4 : 8, glyphHeight: 8, glyphCount, bitmap: charset.slice(), ...(screen ? { screen: screen.slice() } : {}), ...(colorRam ? { colorRam: colorRam.slice() } : {})
  };
}

export const c64RawPlugin: FormatPlugin = {
  definition: rawDefinition,
  probe() { return null; },
  async decode(data, options) { return decodeCharset(data, options); },
  async encode(document, _options: EncodeOptions): Promise<EncodeResult> {
    if (document.kind === "charset") return { data: document.bitmap.slice(), formatId: rawDefinition.id, warnings: [] };
    if (document.modeId === "multicolor-bitmap") return { data: document.components.bitmap ?? encodeKoala(document).slice(2, 8002), formatId: rawDefinition.id, warnings: [] };
    return { data: document.components.bitmap ?? encodeHires(document, "raw"), formatId: rawDefinition.id, warnings: [] };
  },
  analyze(image, target) { const mode = rawModes.find(({ id }) => id === target.modeId); if (!mode) throw new RetroImageError("UNSUPPORTED_MODE", target.modeId); return formatIssues(image, target, mode); },
  async convert(image, target, options) {
    if (target.modeId !== "hires-bitmap" && target.modeId !== "multicolor-bitmap") throw new RetroImageError("UNSUPPORTED_MODE", "Automatic RGBA-to-charset generation is not available; supply native charset and screen components");
    const mode = target.modeId === "hires-bitmap" ? hiresMode : multicolorMode;
    if (options.c64) {
      if (target.modeId === "hires-bitmap") return convertNativeC64(image, target, mode, options, (document) => encodeHires(document, "art"), (output, palette) => {
        const art = output.subarray(2);
        return decodeHires(art.subarray(0, 8000), art.subarray(8000, 9000), rawDefinition.id, { displayProfile: target.displayProfile, palette });
      }, "Optimized raw hires bitmap and screen memory");
      return convertNativeC64(image, target, mode, options, encodeKoala, (output, palette) => {
        const payload = output.subarray(2);
        return decodeMulticolor(payload.subarray(0, 8000), payload.subarray(8000, 9000), payload.subarray(9000, 10000), payload[10000]!, rawDefinition.id, { displayProfile: target.displayProfile, palette });
      }, "Optimized raw multicolor bitmap, screen, color RAM, and background");
    }
    const converted = await genericConvert(image, target, mode, options);
    if (target.modeId === "hires-bitmap") {
      const art = encodeHires(converted.document, "art").subarray(2);
      const document = decodeHires(art.subarray(0, 8000), art.subarray(8000, 9000), rawDefinition.id, { displayProfile: target.displayProfile });
      converted.report.steps.push({ operation: "c64-cells", message: "Optimized raw hires bitmap and screen memory" });
      return { document, report: converted.report };
    }
    const koala = encodeKoala(converted.document).subarray(2);
    const document = decodeMulticolor(koala.subarray(0, 8000), koala.subarray(8000, 9000), koala.subarray(9000, 10000), koala[10000]!, rawDefinition.id, { displayProfile: target.displayProfile });
    converted.report.steps.push({ operation: "c64-cells", message: "Optimized raw multicolor bitmap, screen, color RAM, and background" });
    return { document, report: converted.report };
  }
};

/** All built-in Commodore 64 codecs. */
export const c64Plugins: FormatPlugin[] = [c64KoalaPlugin, c64ArtStudioPlugin, c64DoodlePlugin, c64RawPlugin];
