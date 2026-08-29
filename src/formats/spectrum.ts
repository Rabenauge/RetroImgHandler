import { extensionOf } from "../core/binary";
import { nearestColorIndex } from "../core/color";
import { genericConvert, imagePreview } from "../core/conversion";
import { RetroImageError } from "../core/errors";
import type {
  AnalysisIssue,
  AnalysisResult,
  CodecTarget,
  DecodeOptions,
  EncodeOptions,
  EncodeResult,
  FormatDefinition,
  FormatPlugin,
  RasterDocument,
  RetroImageDocument,
  RgbColor,
  RgbaImage
} from "../core/types";
import { modeAnalysis, rasterDocument } from "./common";

export const spectrumPalette: RgbColor[] = [
  { r: 0, g: 0, b: 0 }, { r: 0, g: 0, b: 205 }, { r: 205, g: 0, b: 0 }, { r: 205, g: 0, b: 205 },
  { r: 0, g: 205, b: 0 }, { r: 0, g: 205, b: 205 }, { r: 205, g: 205, b: 0 }, { r: 205, g: 205, b: 205 },
  { r: 0, g: 0, b: 0 }, { r: 0, g: 0, b: 255 }, { r: 255, g: 0, b: 0 }, { r: 255, g: 0, b: 255 },
  { r: 0, g: 255, b: 0 }, { r: 0, g: 255, b: 255 }, { r: 255, g: 255, b: 0 }, { r: 255, g: 255, b: 255 }
];

const definition: FormatDefinition = {
  schemaVersion: 1,
  id: "zx-spectrum.scr",
  label: "ZX Spectrum screen",
  platform: "ZX Spectrum 48K/128K",
  extensions: ["scr"],
  mimeTypes: ["application/x-zx-spectrum-screen"],
  canDecode: true,
  canEncode: true,
  raw: false,
  modes: [{
    id: "spectrum-screen",
    label: "256x192 attribute screen",
    dimensions: [{ width: 256, height: 192 }],
    pixelAspect: { numerator: 1, denominator: 1 },
    colorModel: "indexed",
    bitsPerPixel: 1,
    maxColors: 15,
    paletteBitsPerChannel: 1,
    palette: { model: "fixed-indexed", displayColorLimit: 15, storableColorEntries: 16, fixedColors: spectrumPalette },
    resolutionClass: "low",
    interlaceSupport: "none",
    displayVariants: [{ id: "pal", label: "PAL", hardwareProfiles: ["ula-48", "ula-128"], videoStandard: "pal", nominalPageSize: { width: 256, height: 192 }, pixelAspect: { numerator: 1, denominator: 1 }, interlaced: false }],
    cell: { width: 8, height: 8, maxColors: 2, sharedAttribute: "bright" },
    hardwareProfiles: ["ula-48", "ula-128"],
    videoStandards: ["pal"],
    supportsTransparency: false,
    notes: ["INK and PAPER share one BRIGHT bit per 8x8 cell", "FLASH is preserved as metadata"]
  }]
};

function bitmapOffset(xByte: number, y: number): number {
  return ((y & 0xc0) << 5) | ((y & 0x07) << 8) | ((y & 0x38) << 2) | xByte;
}

function decodeScr(data: Uint8Array, options: DecodeOptions): RasterDocument {
  if (data.length !== 6912) throw new RetroImageError("INVALID_FILE", "A Spectrum SCR file must be exactly 6912 bytes");
  const indices = new Uint8Array(256 * 192);
  const attributes = data.slice(6144);
  for (let y = 0; y < 192; y += 1) {
    for (let xb = 0; xb < 32; xb += 1) {
      const bits = data[bitmapOffset(xb, y)]!;
      const attribute = attributes[(y >>> 3) * 32 + xb]!;
      const bright = (attribute >>> 6) & 1;
      const ink = (attribute & 7) + bright * 8;
      const paper = ((attribute >>> 3) & 7) + bright * 8;
      for (let bit = 0; bit < 8; bit += 1) indices[y * 256 + xb * 8 + bit] = bits & (0x80 >>> bit) ? ink : paper;
    }
  }
  const assumed = options.displayProfile === undefined;
  return rasterDocument({
    formatId: definition.id,
    modeId: "spectrum-screen",
    width: 256,
    height: 192,
    pixelAspect: { numerator: 1, denominator: 1 },
    displayProfile: options.displayProfile ?? { hardware: "ula-48", videoStandard: "pal", paletteId: "spectrum-canonical" },
    palette: spectrumPalette,
    indices,
    components: { bitmap: data.slice(0, 6144), attributes },
    metadata: { flashCells: [...attributes].filter((value) => (value & 0x80) !== 0).length },
    warnings: assumed ? [{ code: "ASSUMED_DISPLAY_PROFILE", message: "Used the canonical ZX Spectrum 48 PAL profile" }] : [],
    preserved: []
  });
}

function analyzeSpectrum(image: RgbaImage | RetroImageDocument, target: CodecTarget): AnalysisResult {
  const preview = imagePreview(image);
  const issues: AnalysisIssue[] = [];
  if (preview.width === 256 && preview.height === 192) {
    for (let cy = 0; cy < 24; cy += 1) {
      for (let cx = 0; cx < 32; cx += 1) {
        const colors = new Set<number>();
        let bright: number | undefined;
        for (let y = 0; y < 8; y += 1) {
          for (let x = 0; x < 8; x += 1) {
            const pixel = (cy * 8 + y) * 256 + cx * 8 + x;
            const color = nearestColorIndex({
              r: preview.data[pixel * 4]!, g: preview.data[pixel * 4 + 1]!, b: preview.data[pixel * 4 + 2]!
            }, spectrumPalette);
            colors.add(color);
            const nextBright = color >>> 3;
            if (color !== 0 && color !== 8 && bright !== undefined && bright !== nextBright) colors.add(16);
            if (color !== 0 && color !== 8) bright = nextBright;
          }
        }
        if (colors.size > 2 || colors.has(16)) {
          issues.push({ severity: "error", code: "SPECTRUM_CELL_COLORS", message: `Cell ${cx},${cy} exceeds Spectrum attribute limits`, rule: "cell.maxColors", details: { x: cx, y: cy } });
        }
      }
    }
  }
  return modeAnalysis(image, target, definition.modes[0]!, issues);
}

function chooseCellColors(preview: RgbaImage, cx: number, cy: number): { ink: number; paper: number; bright: number } {
  const counts = new Map<number, number>();
  for (let y = 0; y < 8; y += 1) {
    for (let x = 0; x < 8; x += 1) {
      const pixel = (cy * 8 + y) * 256 + cx * 8 + x;
      const color = nearestColorIndex({ r: preview.data[pixel * 4]!, g: preview.data[pixel * 4 + 1]!, b: preview.data[pixel * 4 + 2]! }, spectrumPalette);
      counts.set(color, (counts.get(color) ?? 0) + 1);
    }
  }
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]);
  const first = ranked[0]?.[0] ?? 0;
  const bright = first >>> 3;
  const allowed = ranked.filter(([color]) => color === 0 || (color >>> 3) === bright).map(([color]) => color);
  return { paper: allowed[0] ?? first, ink: allowed[1] ?? allowed[0] ?? first, bright };
}

function encodeScr(document: RetroImageDocument): Uint8Array {
  const preview = document.preview;
  if (preview.width !== 256 || preview.height !== 192) throw new RetroImageError("VALIDATION_FAILED", "Spectrum output must be 256x192");
  if (document.formatId === definition.id && document.components.bitmap?.length === 6144 && document.components.attributes?.length === 768) {
    const output = new Uint8Array(6912);
    output.set(document.components.bitmap);
    output.set(document.components.attributes, 6144);
    return output;
  }
  const output = new Uint8Array(6912);
  for (let cy = 0; cy < 24; cy += 1) {
    for (let cx = 0; cx < 32; cx += 1) {
      const { ink, paper, bright } = chooseCellColors(preview, cx, cy);
      output[6144 + cy * 32 + cx] = (bright << 6) | ((paper & 7) << 3) | (ink & 7);
      for (let y = 0; y < 8; y += 1) {
        let bits = 0;
        for (let x = 0; x < 8; x += 1) {
          const pixel = ((cy * 8 + y) * 256 + cx * 8 + x) * 4;
          const nearest = nearestColorIndex({ r: preview.data[pixel]!, g: preview.data[pixel + 1]!, b: preview.data[pixel + 2]! }, [spectrumPalette[paper]!, spectrumPalette[ink]!]);
          if (nearest === 1) bits |= 0x80 >>> x;
        }
        output[bitmapOffset(cx, cy * 8 + y)] = bits;
      }
    }
  }
  return output;
}

/** ZX Spectrum 48/128 SCR codec. */
export const spectrumScrPlugin: FormatPlugin = {
  definition,
  probe(data, context) {
    if (data.length !== 6912) return null;
    return { formatId: definition.id, confidence: extensionOf(context.filename) === "scr" ? 0.9 : 0.7, reason: "6912-byte Spectrum screen layout" };
  },
  async decode(data, options) { return decodeScr(data, options); },
  async encode(document: RetroImageDocument, _options: EncodeOptions): Promise<EncodeResult> {
    return { data: encodeScr(document), formatId: definition.id, warnings: [] };
  },
  analyze: analyzeSpectrum,
  async convert(image, target, options) {
    const converted = await genericConvert(image, target, definition.modes[0]!, options);
    const document = decodeScr(encodeScr(converted.document), { displayProfile: target.displayProfile });
    converted.report.steps.push({ operation: "spectrum-attributes", message: "Optimized INK/PAPER and shared BRIGHT per 8x8 cell" });
    return { document, report: converted.report };
  }
};

/** All built-in ZX Spectrum codecs. */
export const spectrumPlugins: FormatPlugin[] = [spectrumScrPlugin];
