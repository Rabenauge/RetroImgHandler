import { extensionOf } from "../core/binary";
import { colorDistance, indexedToRgba, nearestColorIndex } from "../core/color";
import { imagePreview, prepareConversionImage } from "../core/conversion";
import { RetroImageError } from "../core/errors";
import type { AnalysisIssue, CharsetDocument, CodecTarget, ConversionOptions, ConversionResult, DecodeOptions, EncodeResult, FormatDefinition, FormatModeDefinition, FormatPlugin, RasterDocument, RetroImageDocument, RgbColor, RgbaImage, StructuredPaletteValueModel } from "../core/types";
import { modeAnalysis, rasterDocument } from "./common";

function hsv(h: number, s: number, v: number): RgbColor {
  const c = v * s;
  const section = (h / 60) % 6;
  const x = c * (1 - Math.abs(section % 2 - 1));
  const [r, g, b] = section < 1 ? [c, x, 0] : section < 2 ? [x, c, 0] : section < 3 ? [0, c, x] : section < 4 ? [0, x, c] : section < 5 ? [x, 0, c] : [c, 0, x];
  const m = v - c;
  return { r: Math.round((r + m) * 255), g: Math.round((g + m) * 255), b: Math.round((b + m) * 255) };
}

/** Generate a deterministic PAL/NTSC preview palette for all GTIA color codes. */
export function atari8Palette(videoStandard: "pal" | "ntsc" = "pal"): RgbColor[] {
  const phase = videoStandard === "pal" ? -8 : 0;
  return Array.from({ length: 256 }, (_, code) => {
    const hue = code >>> 4;
    const luminance = code & 0x0f;
    if (hue === 0) return hsv(0, 0, luminance / 15);
    return hsv((hue - 1) * 24 + phase, 0.72, Math.min(1, 0.12 + luminance / 17));
  });
}

interface RawMode extends FormatModeDefinition {
  storage: "bitmap" | "text" | "gtia";
  bytesPerLine: number;
  scanLinesPerRow: number;
  antic: string;
}

const bitmapModes: RawMode[] = [
  { id: "antic-8", label: "ANTIC 8 / Graphics 3", dimensions: [{ width: 40, height: 24 }], pixelAspect: { numerator: 1, denominator: 1 }, colorModel: "indexed", bitsPerPixel: 2, maxColors: 4, hardwareProfiles: ["antic-gtia"], videoStandards: ["pal", "ntsc"], supportsTransparency: false, storage: "bitmap", bytesPerLine: 10, scanLinesPerRow: 8, antic: "8" },
  { id: "antic-9", label: "ANTIC 9 / Graphics 4", dimensions: [{ width: 80, height: 48 }], pixelAspect: { numerator: 1, denominator: 1 }, colorModel: "indexed", bitsPerPixel: 1, maxColors: 2, hardwareProfiles: ["antic-gtia"], videoStandards: ["pal", "ntsc"], supportsTransparency: false, storage: "bitmap", bytesPerLine: 10, scanLinesPerRow: 4, antic: "9" },
  { id: "antic-a", label: "ANTIC A / Graphics 5", dimensions: [{ width: 80, height: 48 }], pixelAspect: { numerator: 1, denominator: 1 }, colorModel: "indexed", bitsPerPixel: 2, maxColors: 4, hardwareProfiles: ["antic-gtia"], videoStandards: ["pal", "ntsc"], supportsTransparency: false, storage: "bitmap", bytesPerLine: 20, scanLinesPerRow: 4, antic: "A" },
  { id: "antic-b", label: "ANTIC B / Graphics 6", dimensions: [{ width: 160, height: 96 }], pixelAspect: { numerator: 1, denominator: 1 }, colorModel: "indexed", bitsPerPixel: 1, maxColors: 2, hardwareProfiles: ["antic-gtia"], videoStandards: ["pal", "ntsc"], supportsTransparency: false, storage: "bitmap", bytesPerLine: 20, scanLinesPerRow: 2, antic: "B" },
  { id: "antic-c", label: "ANTIC C", dimensions: [{ width: 160, height: 192 }], pixelAspect: { numerator: 2, denominator: 1 }, colorModel: "indexed", bitsPerPixel: 1, maxColors: 2, hardwareProfiles: ["antic-gtia"], videoStandards: ["pal", "ntsc"], supportsTransparency: false, storage: "bitmap", bytesPerLine: 20, scanLinesPerRow: 1, antic: "C" },
  { id: "antic-d", label: "ANTIC D / Graphics 7", dimensions: [{ width: 160, height: 96 }], pixelAspect: { numerator: 1, denominator: 1 }, colorModel: "indexed", bitsPerPixel: 2, maxColors: 4, hardwareProfiles: ["antic-gtia"], videoStandards: ["pal", "ntsc"], supportsTransparency: false, storage: "bitmap", bytesPerLine: 40, scanLinesPerRow: 2, antic: "D" },
  { id: "antic-e", label: "ANTIC E", dimensions: [{ width: 160, height: 192 }], pixelAspect: { numerator: 2, denominator: 1 }, colorModel: "indexed", bitsPerPixel: 2, maxColors: 4, hardwareProfiles: ["antic-gtia"], videoStandards: ["pal", "ntsc"], supportsTransparency: false, storage: "bitmap", bytesPerLine: 40, scanLinesPerRow: 1, antic: "E" },
  { id: "antic-f", label: "ANTIC F / Graphics 8", dimensions: [{ width: 320, height: 192 }], pixelAspect: { numerator: 1, denominator: 1 }, colorModel: "indexed", bitsPerPixel: 1, maxColors: 2, hardwareProfiles: ["antic-gtia"], videoStandards: ["pal", "ntsc"], supportsTransparency: false, storage: "bitmap", bytesPerLine: 40, scanLinesPerRow: 1, antic: "F" },
  { id: "gtia-9", label: "GTIA 9, 16 luminances", dimensions: [{ width: 80, height: 192 }], pixelAspect: { numerator: 4, denominator: 1 }, colorModel: "indexed", bitsPerPixel: 4, maxColors: 16, hardwareProfiles: ["antic-gtia"], videoStandards: ["pal", "ntsc"], supportsTransparency: false, storage: "gtia", bytesPerLine: 40, scanLinesPerRow: 1, antic: "F" },
  { id: "gtia-10", label: "GTIA 10, nine registers", dimensions: [{ width: 80, height: 192 }], pixelAspect: { numerator: 4, denominator: 1 }, colorModel: "indexed", bitsPerPixel: 4, maxColors: 9, hardwareProfiles: ["antic-gtia"], videoStandards: ["pal", "ntsc"], supportsTransparency: false, storage: "gtia", bytesPerLine: 40, scanLinesPerRow: 1, antic: "F" },
  { id: "gtia-11", label: "GTIA 11, 16 hues", dimensions: [{ width: 80, height: 192 }], pixelAspect: { numerator: 4, denominator: 1 }, colorModel: "indexed", bitsPerPixel: 4, maxColors: 16, hardwareProfiles: ["antic-gtia"], videoStandards: ["pal", "ntsc"], supportsTransparency: false, storage: "gtia", bytesPerLine: 40, scanLinesPerRow: 1, antic: "F" }
];

const textModes: RawMode[] = [
  { id: "antic-2-text", label: "ANTIC 2 / Graphics 0 text", dimensions: [{ width: 320, height: 192 }], pixelAspect: { numerator: 1, denominator: 1 }, colorModel: "character", bitsPerPixel: 1, maxColors: 2, cell: { width: 8, height: 8, maxColors: 2 }, hardwareProfiles: ["antic-gtia"], videoStandards: ["pal", "ntsc"], supportsTransparency: false, storage: "text", bytesPerLine: 40, scanLinesPerRow: 8, antic: "2" },
  { id: "antic-3-text", label: "ANTIC 3 descender text", dimensions: [{ width: 320, height: 200 }], pixelAspect: { numerator: 1, denominator: 1 }, colorModel: "character", bitsPerPixel: 1, maxColors: 2, cell: { width: 8, height: 10, maxColors: 2 }, hardwareProfiles: ["antic-gtia"], videoStandards: ["pal", "ntsc"], supportsTransparency: false, storage: "text", bytesPerLine: 40, scanLinesPerRow: 10, antic: "3" },
  { id: "antic-4-text", label: "ANTIC 4 multicolor text", dimensions: [{ width: 160, height: 192 }], pixelAspect: { numerator: 2, denominator: 1 }, colorModel: "character", bitsPerPixel: 2, maxColors: 5, cell: { width: 4, height: 8, maxColors: 4 }, hardwareProfiles: ["antic-gtia"], videoStandards: ["pal", "ntsc"], supportsTransparency: false, storage: "text", bytesPerLine: 40, scanLinesPerRow: 8, antic: "4" },
  { id: "antic-5-text", label: "ANTIC 5 tall multicolor text", dimensions: [{ width: 160, height: 192 }], pixelAspect: { numerator: 1, denominator: 1 }, colorModel: "character", bitsPerPixel: 2, maxColors: 5, cell: { width: 4, height: 16, maxColors: 4 }, hardwareProfiles: ["antic-gtia"], videoStandards: ["pal", "ntsc"], supportsTransparency: false, storage: "text", bytesPerLine: 40, scanLinesPerRow: 16, antic: "5" },
  { id: "antic-6-text", label: "ANTIC 6 colored text", dimensions: [{ width: 160, height: 192 }], pixelAspect: { numerator: 2, denominator: 1 }, colorModel: "character", bitsPerPixel: 1, maxColors: 5, cell: { width: 8, height: 8, maxColors: 2 }, hardwareProfiles: ["antic-gtia"], videoStandards: ["pal", "ntsc"], supportsTransparency: false, storage: "text", bytesPerLine: 20, scanLinesPerRow: 8, antic: "6" },
  { id: "antic-7-text", label: "ANTIC 7 tall colored text", dimensions: [{ width: 160, height: 192 }], pixelAspect: { numerator: 1, denominator: 1 }, colorModel: "character", bitsPerPixel: 1, maxColors: 5, cell: { width: 8, height: 16, maxColors: 2 }, hardwareProfiles: ["antic-gtia"], videoStandards: ["pal", "ntsc"], supportsTransparency: false, storage: "text", bytesPerLine: 20, scanLinesPerRow: 16, antic: "7" }
];
const allModes = [...textModes, ...bitmapModes];

function registerCapability(mode: RawMode): NonNullable<FormatModeDefinition["palette"]> {
  let id = "color-registers";
  let count = mode.maxColors;
  let valueModel: StructuredPaletteValueModel = "gtia-color-code";
  let derivedDisplayColors: number | undefined;
  if (mode.id === "gtia-9") {
    id = "hue";
    count = 1;
    valueModel = "gtia-hue";
    derivedDisplayColors = 16;
  } else if (mode.id === "gtia-11") {
    id = "luminance";
    count = 1;
    valueModel = "gtia-luminance";
    derivedDisplayColors = 16;
  }
  return {
    model: "structured-registers",
    displayColorLimit: mode.maxColors,
    storableColorEntries: count,
    registers: [{ id, count, valueModel, ...(derivedDisplayColors === undefined ? {} : { derivedDisplayColors }) }]
  };
}

for (const mode of allModes) {
  const size = mode.dimensions[0]!;
  mode.palette = registerCapability(mode);
  mode.resolutionClass = size.width <= 80 ? "low" : size.width <= 160 ? "medium" : "high";
  mode.interlaceSupport = "none";
  mode.displayVariants = (["pal", "ntsc"] as const).map((videoStandard) => ({
    id: videoStandard,
    label: videoStandard.toUpperCase(),
    hardwareProfiles: ["antic-gtia"],
    videoStandard,
    nominalPageSize: size,
    pixelAspect: mode.pixelAspect,
    interlaced: false
  }));
}

function def(id: string, label: string, extensions: string[], modes: FormatModeDefinition[], raw = false): FormatDefinition {
  return { schemaVersion: 1, id, label, platform: "Atari 8-bit", extensions, mimeTypes: ["application/x-atari-8bit-image"], canDecode: true, canEncode: true, raw, modes };
}
const rawDefinition = def("atari8.raw", "Atari 8-bit ANTIC/GTIA memory", ["raw", "bin", "fnt", "chr"], allModes, true);
const gr8Definition = def("atari8.gr8", "Atari Graphics 8", ["gr8"], [bitmapModes.find(({ id }) => id === "antic-f")!]);
const gr9Definition = def("atari8.gr9", "Atari Graphics 9", ["gr9"], [bitmapModes.find(({ id }) => id === "gtia-9")!]);
const micDefinition = def("atari8.mic", "Atari MicroPainter/Graphics 15", ["mic", "gr15"], [bitmapModes.find(({ id }) => id === "antic-e")!]);
const picDefinition = def("atari8.pic", "Atari Micro Illustrator PIC", ["pic"], [bitmapModes.find(({ id }) => id === "antic-e")!]);

function displayPalette(options: DecodeOptions): RgbColor[] {
  return options.palette?.length === 256 ? options.palette : atari8Palette(options.displayProfile?.videoStandard ?? "pal");
}

function colorCodes(options: DecodeOptions, count: number): number[] {
  const encoded = options.components?.palette;
  if (encoded) return [...encoded.subarray(0, count)];
  const defaults = count === 2 ? [0, 14] : [0, 40, 136, 202, 14, 72, 104, 184, 216];
  return defaults.slice(0, count);
}

function storedRegisterCount(mode: RawMode): number {
  return mode.palette?.storableColorEntries ?? mode.maxColors;
}

function decodeBitmap(data: Uint8Array, mode: RawMode, options: DecodeOptions, explicitColors?: number[]): RasterDocument {
  const { width, height } = mode.dimensions[0]!;
  const expected = mode.bytesPerLine * height;
  if (data.length < expected) throw new RetroImageError("INVALID_FILE", `${mode.label} requires ${expected} bitmap bytes`);
  const palette = displayPalette(options);
  const colors = explicitColors ?? colorCodes(options, storedRegisterCount(mode));
  const indices = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let xb = 0; xb < mode.bytesPerLine; xb += 1) {
      const value = data[y * mode.bytesPerLine + xb]!;
      if (mode.storage === "gtia") {
        for (let n = 0; n < 2; n += 1) {
          const nibble = (value >>> (4 - n * 4)) & 0xf;
          let code = colors[nibble] ?? 0;
          if (mode.id === "gtia-9") code = ((colors[0] ?? 0) & 0xf0) | nibble;
          if (mode.id === "gtia-11") code = (nibble << 4) | ((colors[0] ?? 0) & 0xf);
          indices[y * width + xb * 2 + n] = code;
        }
      } else {
        const pixels = 8 / mode.bitsPerPixel;
        const mask = (1 << mode.bitsPerPixel) - 1;
        for (let x = 0; x < pixels; x += 1) indices[y * width + xb * pixels + x] = colors[(value >>> ((pixels - x - 1) * mode.bitsPerPixel)) & mask] ?? 0;
      }
    }
  }
  const assumed = options.displayProfile === undefined;
  return rasterDocument({ formatId: rawDefinition.id, modeId: mode.id, width, height, pixelAspect: mode.pixelAspect, displayProfile: options.displayProfile ?? { hardware: "antic-gtia", videoStandard: "pal", paletteId: "atari8-canonical-pal" }, palette, indices, components: { bitmap: data.slice(0, expected), palette: Uint8Array.from(colors) }, metadata: { antic: mode.antic }, warnings: assumed ? [{ code: "ASSUMED_DISPLAY_PROFILE", message: "Used the canonical Atari 8-bit PAL profile" }] : [], preserved: [] });
}

function encodeBitmap(document: RetroImageDocument, mode: RawMode): Uint8Array {
  if (document.kind !== "raster") throw new RetroImageError("VALIDATION_FAILED", "ANTIC bitmap output requires a raster document");
  const colors = [...(document.components.palette ?? Uint8Array.from(colorCodes({}, storedRegisterCount(mode))))];
  const output = new Uint8Array(mode.bytesPerLine * document.height);
  for (let y = 0; y < document.height; y += 1) for (let xb = 0; xb < mode.bytesPerLine; xb += 1) {
    if (mode.storage === "gtia") {
      let value = 0;
      for (let n = 0; n < 2; n += 1) {
        const code = document.indices[y * document.width + xb * 2 + n]!;
        const nibble = mode.id === "gtia-9" ? code & 0xf : mode.id === "gtia-11" ? code >>> 4 : Math.max(0, colors.indexOf(code));
        value |= (nibble & 0xf) << (4 - n * 4);
      }
      output[y * mode.bytesPerLine + xb] = value;
    } else {
      const pixels = 8 / mode.bitsPerPixel;
      let value = 0;
      for (let x = 0; x < pixels; x += 1) {
        const code = document.indices[y * document.width + xb * pixels + x]!;
        value |= Math.max(0, colors.indexOf(code)) << ((pixels - x - 1) * mode.bitsPerPixel);
      }
      output[y * mode.bytesPerLine + xb] = value;
    }
  }
  return output;
}

async function convertBitmap(
  image: RgbaImage | RetroImageDocument,
  target: CodecTarget,
  mode: RawMode,
  options: ConversionOptions
): Promise<ConversionResult> {
  const prepared = prepareConversionImage(image, mode, options);
  const preview = prepared.image;
  const standard = target.displayProfile.videoStandard ?? "pal";
  const hardwarePalette = atari8Palette(standard);
  let codes: number[];
  let candidates: number[];
  if (mode.id === "gtia-9") {
    const hue = bestDerivedRegister(preview, hardwarePalette, "hue");
    candidates = Array.from({ length: 16 }, (_, value) => hue | value);
    codes = [hue];
  } else if (mode.id === "gtia-11") {
    const luminance = bestDerivedRegister(preview, hardwarePalette, "luminance");
    candidates = Array.from({ length: 16 }, (_, value) => (value << 4) | luminance);
    codes = [luminance];
  } else {
    const registerCount = storedRegisterCount(mode);
    const counts = new Map<number, number>();
    for (let pixel = 0; pixel < preview.width * preview.height; pixel += 1) {
      const offset = pixel * 4;
      const code = nearestColorIndex({ r: preview.data[offset]!, g: preview.data[offset + 1]!, b: preview.data[offset + 2]! }, hardwarePalette);
      counts.set(code, (counts.get(code) ?? 0) + 1);
    }
    codes = [...counts].sort((a, b) => b[1] - a[1] || a[0] - b[0]).slice(0, registerCount).map(([code]) => code);
    for (let code = 0; codes.length < registerCount; code += 1) if (!codes.includes(code)) codes.push(code);
    candidates = codes;
  }
  const nativeIndices = new Uint8Array(preview.width * preview.height);
  const candidatePalette = candidates.map((code) => hardwarePalette[code]!);
  for (let i = 0; i < nativeIndices.length; i += 1) {
    const offset = i * 4;
    const selected = nearestColorIndex({ r: preview.data[offset]!, g: preview.data[offset + 1]!, b: preview.data[offset + 2]! }, candidatePalette);
    nativeIndices[i] = candidates[selected] ?? 0;
  }
  const document = rasterDocument({
    formatId: target.formatId,
    modeId: target.modeId,
    width: preview.width,
    height: preview.height,
    pixelAspect: mode.pixelAspect,
    displayProfile: target.displayProfile,
    palette: hardwarePalette,
    indices: nativeIndices,
    components: { palette: Uint8Array.from(codes) },
    metadata: { antic: mode.antic },
    warnings: [],
    preserved: []
  });
  return {
    document,
    report: {
      target,
      steps: [
        ...prepared.steps,
        { operation: "hardware-quantize", message: `Quantized source colors to the ${standard.toUpperCase()} GTIA color-code grid without dithering` },
        { operation: "gtia-registers", message: `Mapped colors to native ${standard.toUpperCase()} GTIA register codes` }
      ],
      warnings: []
    }
  };
}

function bestDerivedRegister(preview: RgbaImage, palette: RgbColor[], kind: "hue" | "luminance"): number {
  let best = 0;
  let bestError = Number.POSITIVE_INFINITY;
  for (let register = 0; register < 16; register += 1) {
    const codes = Array.from({ length: 16 }, (_, value) => kind === "hue" ? (register << 4) | value : (value << 4) | register);
    const colors = codes.map((code) => palette[code]!);
    let error = 0;
    for (let pixel = 0; pixel < preview.width * preview.height; pixel += 1) {
      const offset = pixel * 4;
      const color = { r: preview.data[offset]!, g: preview.data[offset + 1]!, b: preview.data[offset + 2]! };
      error += colorDistance(color, colors[nearestColorIndex(color, colors)]!);
    }
    if (error < bestError) {
      best = register;
      bestError = error;
    }
  }
  return kind === "hue" ? best << 4 : best;
}

function analyzeAtariMode(image: RgbaImage | RetroImageDocument, target: CodecTarget, mode: RawMode) {
  const preview = imagePreview(image);
  const palette = atari8Palette(target.displayProfile.videoStandard ?? "pal");
  const exactCodes = new Map<string, number>();
  palette.forEach(({ r, g, b }, code) => {
    const key = `${r},${g},${b}`;
    if (!exactCodes.has(key)) exactCodes.set(key, code);
  });
  const codes = new Set<number>();
  let outside = 0;
  const seen = new Set<string>();
  for (let pixel = 0; pixel < preview.width * preview.height; pixel += 1) {
    const offset = pixel * 4;
    if (preview.data[offset + 3] === 0) continue;
    const key = `${preview.data[offset]},${preview.data[offset + 1]},${preview.data[offset + 2]}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const code = exactCodes.get(key);
    if (code === undefined) outside += 1;
    else codes.add(code);
  }
  const issues: AnalysisIssue[] = [];
  if (outside > 0) issues.push({ severity: "error", code: "COLOR_OUTSIDE_REGISTER_PALETTE", message: `${outside} visible ${outside === 1 ? "color is" : "colors are"} not an exact ${target.displayProfile.videoStandard?.toUpperCase() ?? "PAL"} GTIA color`, rule: "palette.registers", details: { count: outside } });
  const displayColorLimit = mode.palette?.displayColorLimit ?? mode.maxColors;
  if (codes.size > displayColorLimit) issues.push({ severity: "error", code: "TOO_MANY_COLORS", message: `${codes.size} native colors exceed the ${displayColorLimit}-color display limit`, rule: "palette.displayColorLimit", details: { actual: codes.size, maximum: displayColorLimit } });
  if (mode.id === "gtia-9" && new Set([...codes].map((code) => code >>> 4)).size > 1) issues.push({ severity: "error", code: "ATARI8_REGISTER_STRUCTURE", message: "GTIA 9 requires one hue shared by sixteen luminances", rule: "palette.registers" });
  if (mode.id === "gtia-11" && new Set([...codes].map((code) => code & 0x0f)).size > 1) issues.push({ severity: "error", code: "ATARI8_REGISTER_STRUCTURE", message: "GTIA 11 requires one luminance shared by sixteen hues", rule: "palette.registers" });
  return modeAnalysis(image, target, mode, issues);
}

function decodeText(data: Uint8Array, mode: RawMode, options: DecodeOptions): CharsetDocument {
  const charset = options.components?.charset ?? data;
  const smallCharset = mode.id === "antic-6-text" || mode.id === "antic-7-text";
  const requiredCharset = smallCharset ? 512 : 1024;
  if (charset.length < requiredCharset) throw new RetroImageError("INVALID_FILE", `${mode.label} requires ${requiredCharset} charset bytes`);
  const screen = options.components?.screen;
  const screenRows = mode.id === "antic-3-text" ? 20 : 192 / mode.scanLinesPerRow;
  const screenLength = mode.bytesPerLine * screenRows;
  if (screen && screen.length < screenLength) throw new RetroImageError("INVALID_FILE", `${mode.label} screen memory is truncated`);
  const glyphCount = Math.min(smallCharset ? 64 : 128, Math.floor(charset.length / 8));
  const columns = screen ? mode.bytesPerLine : 16;
  const rows = screen ? screenRows : Math.ceil(glyphCount / columns);
  const logicalGlyphWidth = mode.bitsPerPixel === 2 ? 4 : 8;
  const width = columns * logicalGlyphWidth;
  const height = rows * mode.scanLinesPerRow;
  const indices = new Uint8Array(width * height);
  const colors = colorCodes(options, storedRegisterCount(mode));
  for (let cy = 0; cy < rows; cy += 1) for (let cx = 0; cx < columns; cx += 1) {
    const position = cy * columns + cx;
    if (!screen && position >= glyphCount) continue;
    const code = screen?.[position] ?? position;
    const glyph = mode.id === "antic-6-text" || mode.id === "antic-7-text" ? code & 0x3f : code & 0x7f;
    const foreground = mode.id === "antic-6-text" || mode.id === "antic-7-text" ? colors[1 + (code >>> 6)] ?? colors[1]! : colors[1]!;
    for (let py = 0; py < mode.scanLinesPerRow; py += 1) {
      const sourceRow = mode.id === "antic-3-text" ? Math.max(0, Math.min(7, py - (glyph >= 96 ? 2 : 0))) : Math.floor(py * 8 / mode.scanLinesPerRow);
      const bits = charset[glyph * 8 + sourceRow] ?? 0;
      for (let px = 0; px < logicalGlyphWidth; px += 1) {
        let nativeColor: number;
        if (mode.bitsPerPixel === 2) {
          const value = (bits >>> (6 - px * 2)) & 3;
          nativeColor = value === 3 && (code & 0x80) !== 0 ? colors[4] ?? 0 : colors[value] ?? 0;
        } else {
          const set = (bits & (0x80 >>> px)) !== 0;
          const inverse = (mode.id === "antic-2-text" || mode.id === "antic-3-text") && (code & 0x80) !== 0;
          nativeColor = set !== inverse ? foreground : colors[0]!;
        }
        indices[(cy * mode.scanLinesPerRow + py) * width + cx * logicalGlyphWidth + px] = nativeColor;
      }
    }
  }
  const palette = displayPalette(options);
  return { kind: "charset", formatId: rawDefinition.id, modeId: mode.id, width, height, pixelAspect: mode.pixelAspect, displayProfile: options.displayProfile ?? { hardware: "antic-gtia", videoStandard: "pal", paletteId: "atari8-canonical-pal" }, palette, preview: indexedToRgba(indices, width, height, palette), components: { charset: charset.slice(), palette: Uint8Array.from(colors), ...(screen ? { screen: screen.slice(0, screenLength) } : {}) }, metadata: { antic: mode.antic }, warnings: options.displayProfile ? [] : [{ code: "ASSUMED_DISPLAY_PROFILE", message: "Used the canonical Atari 8-bit PAL profile" }], preserved: [], glyphWidth: logicalGlyphWidth, glyphHeight: mode.scanLinesPerRow, glyphCount, bitmap: charset.slice(), ...(screen ? { screen: screen.slice(0, screenLength) } : {}) };
}

function unpackPic(data: Uint8Array): { bitmap: Uint8Array; colors: number[] } {
  if (data.length < 22 || ![255, 128, 201, 199].every((value, i) => data[i] === value)) throw new RetroImageError("INVALID_FILE", "Invalid Micro Illustrator PIC wrapper");
  const headerOffset = data[4]! | (data[5]! << 8);
  const type = data[7]!;
  const rows = data[12]!;
  if (headerOffset < 21 || rows !== 192 || data[6] !== 1 || data[9] !== 0 || data[10] !== 40 || data[11] !== 0) throw new RetroImageError("INVALID_FILE", "Unsupported Micro Illustrator PIC header");
  let offset = headerOffset + 1;
  const readRle = (): number[] => {
    const values: number[] = [];
    while (offset < data.length && values.length < 7680) {
      let command = data[offset++]!;
      const repeated = command < 128;
      if (!repeated) command -= 128;
      let count = command;
      if (count === 0) {
        if (offset + 1 >= data.length) throw new RetroImageError("INVALID_FILE", "Truncated PIC extended run");
        count = (data[offset++]! << 8) | data[offset++]!;
      }
      if (count <= 0) throw new RetroImageError("INVALID_FILE", "Invalid PIC run length");
      if (repeated) {
        if (offset >= data.length) throw new RetroImageError("INVALID_FILE", "Truncated PIC repeated run");
        const value = data[offset++]!;
        for (let i = 0; i < count; i += 1) values.push(value);
      } else {
        if (offset + count > data.length) throw new RetroImageError("INVALID_FILE", "Truncated PIC literal run");
        values.push(...data.subarray(offset, offset + count)); offset += count;
      }
    }
    return values;
  };
  let bitmap: Uint8Array;
  if (type === 0) {
    if (offset + 7680 > data.length) throw new RetroImageError("INVALID_FILE", "PIC bitmap is truncated");
    bitmap = data.slice(offset, offset + 7680);
  } else {
    const unpacked = readRle();
    if (unpacked.length !== 7680) throw new RetroImageError("INVALID_FILE", "PIC RLE does not expand to 7680 bytes");
    if (type === 2) bitmap = Uint8Array.from(unpacked);
    else if (type === 1) {
      bitmap = new Uint8Array(7680);
      let input = 0;
      for (let x = 0; x < 40; x += 1) for (let start = x; start < 80; start += 40) for (let out = start; out < 7680; out += 80) bitmap[out] = unpacked[input++]!;
    } else throw new RetroImageError("UNSUPPORTED_MODE", `Unsupported PIC compression type ${type}`);
  }
  return { bitmap, colors: [...data.subarray(13, 17)] };
}

function encodePic(document: RetroImageDocument, mode: RawMode): Uint8Array {
  const bitmap = encodeBitmap(document, mode);
  const output = new Uint8Array(22 + bitmap.length);
  output.set([255, 128, 201, 199, 21, 0, 1, 0, 14, 0, 40, 0, 192]);
  output.set((document.components.palette ?? Uint8Array.from([0, 40, 136, 202])).subarray(0, 4), 13);
  output[20] = 0; output[21] = 0; output.set(bitmap, 22);
  return output;
}

function rawMode(options: DecodeOptions): RawMode {
  if (!options.modeId) throw new RetroImageError("MISSING_HINT", "Atari 8-bit raw decode requires modeId");
  const mode = allModes.find(({ id }) => id === options.modeId);
  if (!mode) throw new RetroImageError("UNSUPPORTED_MODE", options.modeId);
  return mode;
}

export const atari8RawPlugin: FormatPlugin = {
  definition: rawDefinition,
  probe() { return null; },
  async decode(data, options) { const mode = rawMode(options); return mode.storage === "text" ? decodeText(data, mode, options) : decodeBitmap(data, mode, options); },
  async encode(document): Promise<EncodeResult> { if (document.kind === "charset") return { data: document.screen ?? new Uint8Array(), formatId: rawDefinition.id, warnings: [] }; const mode = allModes.find(({ id }) => id === document.modeId); if (!mode) throw new RetroImageError("UNSUPPORTED_MODE", document.modeId); return { data: encodeBitmap(document, mode), formatId: rawDefinition.id, warnings: [] }; },
  analyze(image, target) { const mode = allModes.find(({ id }) => id === target.modeId); if (!mode) throw new RetroImageError("UNSUPPORTED_MODE", target.modeId); return analyzeAtariMode(image, target, mode); },
  async convert(image, target, options) { const mode = allModes.find(({ id }) => id === target.modeId); if (!mode) throw new RetroImageError("UNSUPPORTED_MODE", target.modeId); if (mode.storage === "text") throw new RetroImageError("UNSUPPORTED_MODE", "Automatic RGBA-to-charset generation is not available; supply native screen and charset components"); const converted = await convertBitmap(image, target, mode, options); converted.document.components.bitmap = encodeBitmap(converted.document, mode); return converted; }
};

function fixedBitmapPlugin(definition: FormatDefinition, modeId: string, lengths: number[], decode: (data: Uint8Array, options: DecodeOptions) => RasterDocument, encode: (document: RetroImageDocument) => Uint8Array): FormatPlugin {
  return {
    definition,
    probe(data, context) {
      if (!lengths.includes(data.length)) return null;
      const ext = extensionOf(context.filename);
      return { formatId: definition.id, confidence: definition.extensions.includes(ext) ? 0.95 : 0.55, reason: `${definition.label} size and extension` };
    },
    async decode(data, options) { const document = decode(data, options); document.formatId = definition.id; return document; },
    async encode(document): Promise<EncodeResult> { return { data: encode(document), formatId: definition.id, warnings: [] }; },
    analyze(image, target) { return analyzeAtariMode(image, target, allModes.find(({ id }) => id === modeId)!); },
    async convert(image, target, options) { const mode = allModes.find(({ id }) => id === modeId)!; const converted = await convertBitmap(image, target, mode, options); const stored = encode(converted.document); const document = decode(stored, { displayProfile: target.displayProfile }); document.formatId = definition.id; document.components.stored = stored; converted.report.steps.push({ operation: "atari8-layout", message: `Packed ${definition.label} native memory layout` }); return { document, report: converted.report }; }
  };
}

const anticF = bitmapModes.find(({ id }) => id === "antic-f")!;
const gtia9 = bitmapModes.find(({ id }) => id === "gtia-9")!;
const anticE = bitmapModes.find(({ id }) => id === "antic-e")!;
export const atari8Gr8Plugin = fixedBitmapPlugin(gr8Definition, "antic-f", [7680], (data, options) => decodeBitmap(data, anticF, options), (document) => encodeBitmap(document, anticF));
export const atari8Gr9Plugin = fixedBitmapPlugin(gr9Definition, "gtia-9", [7680, 7684], (data, options) => decodeBitmap(data.subarray(0, 7680), gtia9, options, [data[7680] ?? 0]), (document) => {
  const output = new Uint8Array(7684);
  output.set(encodeBitmap(document, gtia9));
  output[7680] = document.components.palette?.[0] ?? 0;
  return output;
});
export const atari8MicPlugin = fixedBitmapPlugin(micDefinition, "antic-e", [7680, 7681, 7682, 7683, 7684, 7685], (data, options) => decodeBitmap(data.subarray(0, 7680), anticE, options, data.length >= 7684 ? [...data.subarray(7680, 7684)] : undefined), (document) => {
  const bitmap = encodeBitmap(document, anticE), output = new Uint8Array(7684); output.set(bitmap); output.set((document.components.palette ?? Uint8Array.from([0, 40, 136, 202])).subarray(0, 4), 7680); return output;
});

export const atari8PicPlugin: FormatPlugin = {
  definition: picDefinition,
  probe(data, context) {
    const magic = data.length >= 22 && data[0] === 255 && data[1] === 128 && data[2] === 201 && data[3] === 199;
    if (!magic) return null;
    return { formatId: picDefinition.id, confidence: extensionOf(context.filename) === "pic" ? 1 : 0.95, reason: "Micro Illustrator PIC wrapper signature" };
  },
  async decode(data, options) { const { bitmap, colors } = unpackPic(data); const document = decodeBitmap(bitmap, anticE, options, colors); document.formatId = picDefinition.id; document.components.stored = data.slice(); return document; },
  async encode(document): Promise<EncodeResult> { return { data: encodePic(document, anticE), formatId: picDefinition.id, warnings: [] }; },
  analyze(image, target) { return analyzeAtariMode(image, target, anticE); },
  async convert(image, target, options) { const converted = await convertBitmap(image, target, anticE, options); const stored = encodePic(converted.document, anticE); const unpacked = unpackPic(stored); const document = decodeBitmap(unpacked.bitmap, anticE, { displayProfile: target.displayProfile }, unpacked.colors); document.formatId = picDefinition.id; document.components.stored = stored; converted.report.steps.push({ operation: "atari8-pic", message: "Packed Micro Illustrator PIC wrapper" }); return { document, report: converted.report }; }
};

/** All built-in Atari 8-bit codecs. */
export const atari8Plugins: FormatPlugin[] = [atari8Gr8Plugin, atari8Gr9Plugin, atari8MicPlugin, atari8PicPlugin, atari8RawPlugin];
