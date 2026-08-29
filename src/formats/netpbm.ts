import { RetroImageError } from "../core/errors";
import type {
  AnalysisIssue,
  AnalysisResult,
  CodecTarget,
  ConversionOptions,
  ConversionResult,
  DecodeOptions,
  EncodeOptions,
  EncodeResult,
  FloatSampledRasterDocument,
  FormatDefinition,
  FormatModeDefinition,
  FormatPlugin,
  IntegerSampledRasterDocument,
  PfmByteOrder,
  PfmRowOrder,
  PfmToneMapping,
  ProbeContext,
  RetroImageDocument,
  RgbaImage,
  SampleChannelModel
} from "../core/types";

type PnmFamily = "pbm" | "pgm" | "ppm";
type PnmMode = "plain" | "raw";

const VARIABLE_RANGE = { minWidth: 1, maxWidth: 16_777_216, minHeight: 1, maxHeight: 16_777_216 };

function pnmModes(family: PnmFamily): FormatModeDefinition[] {
  const labels = family === "pbm" ? ["Plain PBM (P1)", "Raw PBM (P4)"]
    : family === "pgm" ? ["Plain PGM (P2)", "Raw PGM (P5)"]
      : ["Plain PPM (P3)", "Raw PPM (P6)"];
  const bitsPerPixel = family === "pbm" ? 1 : family === "pgm" ? 16 : 48;
  const maxColors = family === "pbm" ? 2 : family === "pgm" ? 65_536 : 2 ** 48;
  return (["plain", "raw"] as const).map((id, index) => ({
    id,
    label: labels[index]!,
    dimensions: [],
    dimensionRange: VARIABLE_RANGE,
    pixelAspect: { numerator: 1, denominator: 1 },
    colorModel: "direct",
    bitsPerPixel,
    maxColors,
    palette: { model: "sampled-direct", displayColorLimit: maxColors, storableColorEntries: 0 },
    resolutionClass: "sampled",
    interlaceSupport: "none",
    sample: {
      sampleType: "uint",
      channelModel: family === "pbm" ? "black-and-white" : family === "pgm" ? "grayscale" : "rgb",
      alpha: "none",
      maxSampleValue: family === "pbm" ? { minimum: 1, maximum: 1, fixed: 1 } : { minimum: 1, maximum: 65_535 }
    },
    hardwareProfiles: ["generic"],
    videoStandards: [],
    supportsTransparency: false,
    notes: family === "pbm" ? ["PBM stores 0 as white and 1 as black"] : ["Maxval may range from 1 through 65535"]
  }));
}

function pnmDefinition(family: PnmFamily): FormatDefinition {
  const name = family === "pbm" ? "Portable Bitmap" : family === "pgm" ? "Portable Graymap" : "Portable Pixmap";
  const mime = family === "pbm" ? "image/x-portable-bitmap"
    : family === "pgm" ? "image/x-portable-graymap"
      : "image/x-portable-pixmap";
  return {
    schemaVersion: 1,
    id: `netpbm.${family}`,
    label: `Netpbm ${name}`,
    platform: "Netpbm",
    extensions: [family, "pnm"],
    mimeTypes: [mime, "image/x-portable-anymap"],
    canDecode: true,
    canEncode: true,
    raw: false,
    modes: pnmModes(family)
  };
}

const PBM_DEFINITION = pnmDefinition("pbm");
const PGM_DEFINITION = pnmDefinition("pgm");
const PPM_DEFINITION = pnmDefinition("ppm");

const PAM_LAYOUTS = {
  "black-and-white": { tupleType: "BLACKANDWHITE", channelModel: "black-and-white", channelCount: 1, bitsPerPixel: 1, maxColors: 2, alpha: false },
  "black-and-white-alpha": { tupleType: "BLACKANDWHITE_ALPHA", channelModel: "black-and-white-alpha", channelCount: 2, bitsPerPixel: 2, maxColors: 4, alpha: true },
  grayscale: { tupleType: "GRAYSCALE", channelModel: "grayscale", channelCount: 1, bitsPerPixel: 16, maxColors: 65_536, alpha: false },
  "grayscale-alpha": { tupleType: "GRAYSCALE_ALPHA", channelModel: "grayscale-alpha", channelCount: 2, bitsPerPixel: 32, maxColors: 2 ** 32, alpha: true },
  rgb: { tupleType: "RGB", channelModel: "rgb", channelCount: 3, bitsPerPixel: 48, maxColors: 2 ** 48, alpha: false },
  "rgb-alpha": { tupleType: "RGB_ALPHA", channelModel: "rgb-alpha", channelCount: 4, bitsPerPixel: 64, maxColors: 2 ** 64, alpha: true }
} as const;

type PamMode = keyof typeof PAM_LAYOUTS;

const PAM_DEFINITION: FormatDefinition = {
  schemaVersion: 1,
  id: "netpbm.pam",
  label: "Netpbm Portable Arbitrary Map",
  platform: "Netpbm",
  extensions: ["pam"],
  mimeTypes: ["image/x-portable-arbitrarymap"],
  canDecode: true,
  canEncode: true,
  raw: false,
  modes: Object.entries(PAM_LAYOUTS).map(([id, layout]) => ({
    id,
    label: `PAM ${layout.tupleType}`,
    dimensions: [],
    dimensionRange: VARIABLE_RANGE,
    pixelAspect: { numerator: 1, denominator: 1 },
    colorModel: "direct",
    bitsPerPixel: layout.bitsPerPixel,
    maxColors: layout.maxColors,
    palette: { model: "sampled-direct", displayColorLimit: layout.maxColors, storableColorEntries: 0 },
    resolutionClass: "sampled",
    interlaceSupport: "none",
    sample: {
      sampleType: "uint",
      channelModel: layout.channelModel,
      alpha: layout.alpha ? "straight" : "none",
      maxSampleValue: layout.tupleType.includes("BLACKANDWHITE") ? { minimum: 1, maximum: 1, fixed: 1 } : { minimum: 1, maximum: 65_535 }
    },
    hardwareProfiles: ["generic"],
    videoStandards: [],
    supportsTransparency: layout.alpha,
    notes: [layout.tupleType.includes("BLACKANDWHITE") ? "Maxval must be 1" : "Maxval may range from 1 through 65535"]
  }))
};

const PFM_DEFINITION: FormatDefinition = {
  schemaVersion: 1,
  id: "netpbm.pfm",
  label: "Portable Float Map",
  platform: "PFM",
  extensions: ["pfm"],
  mimeTypes: [],
  canDecode: true,
  canEncode: true,
  raw: false,
  modes: [
    {
      id: "grayscale",
      label: "PFM grayscale (Pf)",
      dimensions: [],
      dimensionRange: VARIABLE_RANGE,
      pixelAspect: { numerator: 1, denominator: 1 },
      colorModel: "direct",
      bitsPerPixel: 32,
      maxColors: 2 ** 32,
      palette: { model: "sampled-direct", displayColorLimit: 2 ** 32, storableColorEntries: 0 },
      resolutionClass: "sampled",
      interlaceSupport: "none",
      sample: { sampleType: "float32", channelModel: "grayscale", alpha: "none", byteOrders: ["big-endian", "little-endian"], rowOrders: ["top-down", "bottom-up"], preservesScaleFactor: true },
      hardwareProfiles: ["generic"],
      videoStandards: [],
      supportsTransparency: false,
      notes: ["IEEE-754 Float32 samples"]
    },
    {
      id: "rgb",
      label: "PFM RGB (PF)",
      dimensions: [],
      dimensionRange: VARIABLE_RANGE,
      pixelAspect: { numerator: 1, denominator: 1 },
      colorModel: "direct",
      bitsPerPixel: 96,
      maxColors: 2 ** 96,
      palette: { model: "sampled-direct", displayColorLimit: 2 ** 96, storableColorEntries: 0 },
      resolutionClass: "sampled",
      interlaceSupport: "none",
      sample: { sampleType: "float32", channelModel: "rgb", alpha: "none", byteOrders: ["big-endian", "little-endian"], rowOrders: ["top-down", "bottom-up"], preservesScaleFactor: true },
      hardwareProfiles: ["generic"],
      videoStandards: [],
      supportsTransparency: false,
      notes: ["IEEE-754 Float32 samples"]
    }
  ]
};

class NetpbmScanner {
  offset = 0;
  readonly comments: string[] = [];

  constructor(readonly data: Uint8Array) {}

  token(): string | null {
    this.skipSpaceAndComments();
    if (this.offset >= this.data.length) return null;
    const start = this.offset;
    while (this.offset < this.data.length && !isSpace(this.data[this.offset]!) && this.data[this.offset] !== 0x23) {
      const byte = this.data[this.offset]!;
      if (byte < 0x21 || byte > 0x7e) throw new RetroImageError("INVALID_FILE", "Netpbm header contains a non-ASCII token");
      this.offset += 1;
    }
    return ascii(this.data.subarray(start, this.offset));
  }

  rawRasterStart(expectedRasterBytes: number): number {
    if (this.offset >= this.data.length || (!isSpace(this.data[this.offset]!) && this.data[this.offset] !== 0x23)) {
      throw new RetroImageError("INVALID_FILE", "Raw Netpbm header is missing its raster separator");
    }
    if (isSpace(this.data[this.offset]!)) {
      const first = this.data[this.offset++]!;
      if (first === 0x0d && this.data[this.offset] === 0x0a) this.offset += 1;
      if (this.data.length - this.offset === expectedRasterBytes || first === 0x0a || first === 0x0d) return this.offset;
      while (this.offset < this.data.length && this.data[this.offset] !== 0x0a && this.data[this.offset] !== 0x0d && isSpace(this.data[this.offset]!)) this.offset += 1;
    }
    if (this.data[this.offset] === 0x23) {
      this.offset += 1;
      const start = this.offset;
      while (this.offset < this.data.length && this.data[this.offset] !== 0x0a && this.data[this.offset] !== 0x0d) this.offset += 1;
      this.comments.push(ascii(this.data.subarray(start, this.offset)));
      if (this.offset >= this.data.length) throw new RetroImageError("INVALID_FILE", "Raw Netpbm comment is missing its raster separator");
      const first = this.data[this.offset++]!;
      if (first === 0x0d && this.data[this.offset] === 0x0a) this.offset += 1;
    }
    return this.offset;
  }

  private skipSpaceAndComments(): void {
    while (this.offset < this.data.length) {
      if (isSpace(this.data[this.offset]!)) {
        this.offset += 1;
        continue;
      }
      if (this.data[this.offset] !== 0x23) return;
      this.offset += 1;
      const start = this.offset;
      while (this.offset < this.data.length && this.data[this.offset] !== 0x0a && this.data[this.offset] !== 0x0d) this.offset += 1;
      this.comments.push(ascii(this.data.subarray(start, this.offset)));
    }
  }
}

function ascii(data: Uint8Array): string {
  let value = "";
  for (const byte of data) value += String.fromCharCode(byte);
  return value;
}

function asciiBytes(value: string): Uint8Array {
  const result = new Uint8Array(value.length);
  for (let index = 0; index < value.length; index += 1) result[index] = value.charCodeAt(index);
  return result;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const result = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

function isSpace(byte: number): boolean {
  return byte === 0x20 || byte === 0x09 || byte === 0x0a || byte === 0x0d || byte === 0x0b || byte === 0x0c;
}

function positiveInteger(token: string | null, name: string): number {
  if (token === null || !/^[0-9]+$/.test(token)) throw new RetroImageError("INVALID_FILE", `${name} must be a positive integer`);
  const value = Number(token);
  if (!Number.isSafeInteger(value) || value < 1) throw new RetroImageError("INVALID_FILE", `${name} must be a positive integer`);
  return value;
}

function checkedSampleCount(width: number, height: number, channels: number, options: DecodeOptions): number {
  const pixels = width * height;
  if (!Number.isSafeInteger(pixels) || pixels > (options.limits?.maxPixels ?? 16_777_216)) {
    throw new RetroImageError("LIMIT_EXCEEDED", "Netpbm image exceeds the pixel limit");
  }
  const samples = pixels * channels;
  if (!Number.isSafeInteger(samples)) throw new RetroImageError("LIMIT_EXCEEDED", "Netpbm sample count is unsafe");
  return samples;
}

function magicFor(family: PnmFamily, mode: PnmMode): string {
  const base = family === "pbm" ? 1 : family === "pgm" ? 2 : 3;
  return `P${mode === "plain" ? base : base + 3}`;
}

function familyForMagic(magic: string): { family: PnmFamily; mode: PnmMode } | null {
  if (!/^P[1-6]$/.test(magic)) return null;
  const code = Number(magic[1]);
  const family = (["pbm", "pgm", "ppm"] as const)[(code - 1) % 3]!;
  return { family, mode: code <= 3 ? "plain" : "raw" };
}

function startsAnotherImage(data: Uint8Array, offset: number): boolean {
  while (offset < data.length && isSpace(data[offset]!)) offset += 1;
  return data[offset] === 0x50 && data[offset + 1] !== undefined
    && ((data[offset + 1]! >= 0x31 && data[offset + 1]! <= 0x37) || data[offset + 1] === 0x46 || data[offset + 1] === 0x66);
}

function bt709ToLinear(value: number): number {
  return value < 0.081 ? value / 4.5 : ((value + 0.099) / 1.099) ** (1 / 0.45);
}

function linearToSrgb(value: number): number {
  const encoded = value <= 0.0031308 ? 12.92 * value : 1.055 * value ** (1 / 2.4) - 0.055;
  return Math.max(0, Math.min(255, Math.round(encoded * 255)));
}

function srgbToLinear(value: number): number {
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

function linearToBt709(value: number): number {
  return value < 0.018 ? 4.5 * value : 1.099 * value ** 0.45 - 0.099;
}

function integerPreview(
  samples: Uint16Array,
  width: number,
  height: number,
  channelModel: "black-and-white" | "grayscale" | "rgb",
  maxSampleValue: number,
  pbm: boolean
): RgbaImage {
  const data = new Uint8ClampedArray(width * height * 4);
  const channels = channelModel === "rgb" ? 3 : 1;
  for (let pixel = 0; pixel < width * height; pixel += 1) {
    const target = pixel * 4;
    if (channelModel === "black-and-white") {
      const value = pbm ? (samples[pixel] === 0 ? 255 : 0) : (samples[pixel] === 0 ? 0 : 255);
      data.set([value, value, value, 255], target);
    } else {
      for (let channel = 0; channel < 3; channel += 1) {
        const sourceChannel = channels === 1 ? 0 : channel;
        const normalized = samples[pixel * channels + sourceChannel]! / maxSampleValue;
        data[target + channel] = linearToSrgb(bt709ToLinear(normalized));
      }
      data[target + 3] = 255;
    }
  }
  return { width, height, data };
}

function readPlainSamples(scanner: NetpbmScanner, count: number, maxval: number): Uint16Array {
  const samples = new Uint16Array(count);
  for (let index = 0; index < count; index += 1) {
    const value = positiveIntegerAllowZero(scanner.token(), "sample");
    if (value > maxval) throw new RetroImageError("INVALID_FILE", `Netpbm sample ${value} exceeds maxval ${maxval}`);
    samples[index] = value;
  }
  const trailing = scanner.token();
  if (trailing !== null) {
    if (familyForMagic(trailing) !== null || trailing === "P7" || trailing === "PF" || trailing === "Pf") {
      throw new RetroImageError("UNSUPPORTED_SEQUENCE", "Netpbm image sequences are not supported");
    }
    throw new RetroImageError("INVALID_FILE", "Unexpected data after the Netpbm raster");
  }
  return samples;
}

function positiveIntegerAllowZero(token: string | null, name: string): number {
  if (token === null || !/^[0-9]+$/.test(token)) throw new RetroImageError("INVALID_FILE", `${name} must be an unsigned integer`);
  const value = Number(token);
  if (!Number.isSafeInteger(value)) throw new RetroImageError("INVALID_FILE", `${name} is too large`);
  return value;
}

function readRawSamples(
  data: Uint8Array,
  start: number,
  family: PnmFamily,
  width: number,
  height: number,
  channels: number,
  maxval: number
): Uint16Array {
  if (family === "pbm") {
    const rowBytes = Math.ceil(width / 8);
    const end = start + rowBytes * height;
    if (end > data.length) throw new RetroImageError("INVALID_FILE", "PBM raster is truncated");
    const samples = new Uint16Array(width * height);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        samples[y * width + x] = (data[start + y * rowBytes + (x >>> 3)]! >>> (7 - (x & 7))) & 1;
      }
    }
    ensureRawEnd(data, end);
    return samples;
  }
  const bytesPerSample = maxval < 256 ? 1 : 2;
  const count = width * height * channels;
  const end = start + count * bytesPerSample;
  if (!Number.isSafeInteger(end) || end > data.length) throw new RetroImageError("INVALID_FILE", "Netpbm raster is truncated");
  const samples = new Uint16Array(count);
  let offset = start;
  for (let index = 0; index < count; index += 1) {
    const value = bytesPerSample === 1 ? data[offset++]! : (data[offset++]! << 8) | data[offset++]!;
    if (value > maxval) throw new RetroImageError("INVALID_FILE", `Netpbm sample ${value} exceeds maxval ${maxval}`);
    samples[index] = value;
  }
  ensureRawEnd(data, end);
  return samples;
}

function ensureRawEnd(data: Uint8Array, end: number): void {
  if (end === data.length) return;
  if (startsAnotherImage(data, end)) throw new RetroImageError("UNSUPPORTED_SEQUENCE", "Netpbm image sequences are not supported");
  throw new RetroImageError("INVALID_FILE", "Unexpected data after the Netpbm raster");
}

interface PamHeader {
  width: number;
  height: number;
  depth: number;
  maxval: number;
  tupleType: string;
  rasterStart: number;
  comments: string[];
}

function nextLine(data: Uint8Array, offset: number): { line: string; next: number } {
  const start = offset;
  while (offset < data.length && data[offset] !== 0x0a) offset += 1;
  if (offset >= data.length) throw new RetroImageError("INVALID_FILE", "PAM header line is not terminated");
  let end = offset;
  if (end > start && data[end - 1] === 0x0d) end -= 1;
  return { line: ascii(data.subarray(start, end)), next: offset + 1 };
}

function parsePamHeader(data: Uint8Array): PamHeader {
  const magic = nextLine(data, 0);
  if (magic.line !== "P7") throw new RetroImageError("INVALID_FILE", "Expected a PAM P7 header");
  let offset = magic.next;
  const values = new Map<string, string>();
  const tupleParts: string[] = [];
  const comments: string[] = [];
  while (offset < data.length) {
    const parsed = nextLine(data, offset);
    offset = parsed.next;
    const trimmed = parsed.line.trim();
    if (trimmed.length === 0) continue;
    if (trimmed.startsWith("#")) {
      comments.push(parsed.line.slice(parsed.line.indexOf("#") + 1));
      continue;
    }
    const space = trimmed.search(/\s/);
    const key = space < 0 ? trimmed : trimmed.slice(0, space);
    const value = space < 0 ? "" : trimmed.slice(space).trim();
    if (key === "ENDHDR") {
      if (value.length > 0) throw new RetroImageError("INVALID_FILE", "PAM ENDHDR must not have a value");
      for (const required of ["WIDTH", "HEIGHT", "DEPTH", "MAXVAL"]) {
        if (!values.has(required)) throw new RetroImageError("INVALID_FILE", `PAM header is missing ${required}`);
      }
      return {
        width: positiveInteger(values.get("WIDTH") ?? null, "PAM width"),
        height: positiveInteger(values.get("HEIGHT") ?? null, "PAM height"),
        depth: positiveInteger(values.get("DEPTH") ?? null, "PAM depth"),
        maxval: positiveInteger(values.get("MAXVAL") ?? null, "PAM maxval"),
        tupleType: tupleParts.join(" "),
        rasterStart: offset,
        comments
      };
    }
    if (key === "TUPLTYPE") {
      if (value.length === 0) throw new RetroImageError("INVALID_FILE", "PAM TUPLTYPE must have a value");
      tupleParts.push(value);
      continue;
    }
    if (!["WIDTH", "HEIGHT", "DEPTH", "MAXVAL"].includes(key) || value.length === 0) {
      throw new RetroImageError("INVALID_FILE", `Unknown or invalid PAM header field ${key}`);
    }
    if (values.has(key)) throw new RetroImageError("INVALID_FILE", `PAM header contains duplicate ${key}`);
    values.set(key, value);
  }
  throw new RetroImageError("INVALID_FILE", "PAM header is missing ENDHDR");
}

function pamMode(tupleType: string): PamMode | null {
  for (const [mode, layout] of Object.entries(PAM_LAYOUTS) as Array<[PamMode, (typeof PAM_LAYOUTS)[PamMode]]>) {
    if (layout.tupleType === tupleType) return mode;
  }
  return null;
}

function pamPreview(document: Pick<IntegerSampledRasterDocument, "samples" | "width" | "height" | "channelModel" | "channelCount" | "maxSampleValue">): RgbaImage {
  const data = new Uint8ClampedArray(document.width * document.height * 4);
  for (let pixel = 0; pixel < document.width * document.height; pixel += 1) {
    const source = pixel * document.channelCount;
    const target = pixel * 4;
    const alphaChannel = document.channelModel.endsWith("-alpha") ? document.channelCount - 1 : -1;
    const colorModel = document.channelModel.replace("-alpha", "");
    if (colorModel === "black-and-white") {
      const value = document.samples[source] === 0 ? 0 : 255;
      data.set([value, value, value], target);
    } else if (colorModel === "grayscale") {
      const value = linearToSrgb(bt709ToLinear(document.samples[source]! / document.maxSampleValue));
      data.set([value, value, value], target);
    } else {
      for (let channel = 0; channel < 3; channel += 1) {
        data[target + channel] = linearToSrgb(bt709ToLinear(document.samples[source + channel]! / document.maxSampleValue));
      }
    }
    data[target + 3] = alphaChannel < 0 ? 255 : Math.round(document.samples[source + alphaChannel]! * 255 / document.maxSampleValue);
  }
  return { width: document.width, height: document.height, data };
}

async function decodePam(data: Uint8Array, options: DecodeOptions): Promise<IntegerSampledRasterDocument> {
  const header = parsePamHeader(data);
  if (header.maxval > 65_535) throw new RetroImageError("INVALID_FILE", "PAM maxval must not exceed 65535");
  const modeId = pamMode(header.tupleType);
  if (!modeId) throw new RetroImageError("UNSUPPORTED_MODE", `Unsupported PAM tuple type ${header.tupleType || "(empty)"}`);
  const layout = PAM_LAYOUTS[modeId];
  if (header.depth !== layout.channelCount) throw new RetroImageError("INVALID_FILE", `PAM ${layout.tupleType} requires depth ${layout.channelCount}`);
  if (layout.tupleType.startsWith("BLACKANDWHITE") && header.maxval !== 1) {
    throw new RetroImageError("INVALID_FILE", `PAM ${layout.tupleType} requires maxval 1`);
  }
  checkedSampleCount(header.width, header.height, header.depth, options);
  const samples = readRawSamples(data, header.rasterStart, "pgm", header.width, header.height, header.depth, header.maxval);
  const base = {
    samples,
    width: header.width,
    height: header.height,
    channelModel: layout.channelModel,
    channelCount: layout.channelCount,
    maxSampleValue: header.maxval
  };
  return {
    kind: "sampled-raster",
    formatId: PAM_DEFINITION.id,
    modeId,
    width: header.width,
    height: header.height,
    pixelAspect: { numerator: 1, denominator: 1 },
    displayProfile: options.displayProfile ?? { hardware: "generic" },
    palette: [],
    preview: pamPreview(base),
    components: {},
    metadata: { netpbmComments: header.comments },
    warnings: [],
    preserved: [],
    sampleType: "uint",
    channelModel: layout.channelModel,
    channelCount: layout.channelCount,
    samples,
    maxSampleValue: header.maxval
  };
}

function validatePamDocument(document: RetroImageDocument, modeId: string): IntegerSampledRasterDocument {
  if (!(modeId in PAM_LAYOUTS)) throw new RetroImageError("UNSUPPORTED_MODE", `Unknown PAM mode ${modeId}`);
  if (document.kind !== "sampled-raster" || document.sampleType !== "uint") {
    throw new RetroImageError("VALIDATION_FAILED", "PAM requires unsigned sampled raster data");
  }
  const layout = PAM_LAYOUTS[modeId as PamMode];
  if (document.channelModel !== layout.channelModel || document.channelCount !== layout.channelCount
    || document.samples.length !== document.width * document.height * layout.channelCount) {
    throw new RetroImageError("VALIDATION_FAILED", `PAM ${layout.tupleType} channel layout is invalid`);
  }
  if (!Number.isInteger(document.maxSampleValue) || document.maxSampleValue < 1 || document.maxSampleValue > 65_535
    || (layout.tupleType.startsWith("BLACKANDWHITE") && document.maxSampleValue !== 1)
    || document.samples.some((sample) => sample > document.maxSampleValue)) {
    throw new RetroImageError("VALIDATION_FAILED", `PAM ${layout.tupleType} sample range is invalid`);
  }
  return document;
}

async function encodePam(document: RetroImageDocument, options: EncodeOptions): Promise<EncodeResult> {
  const modeId = options.target?.modeId ?? document.modeId;
  const sampled = validatePamDocument(document, modeId);
  const layout = PAM_LAYOUTS[modeId as PamMode];
  const comments = commentsOf(sampled).map((comment) => `#${comment}\n`).join("");
  const pamHeader = asciiBytes(
    `P7\n${comments}WIDTH ${sampled.width}\nHEIGHT ${sampled.height}\nDEPTH ${layout.channelCount}\nMAXVAL ${sampled.maxSampleValue}\nTUPLTYPE ${layout.tupleType}\nENDHDR\n`
  );
  return { data: concat([pamHeader, rawRaster(sampled, "pgm")]), formatId: PAM_DEFINITION.id, warnings: [] };
}

function probePam(data: Uint8Array, _context: ProbeContext) {
  if (data[0] !== 0x50 || data[1] !== 0x37 || (data[2] !== 0x0a && !(data[2] === 0x0d && data[3] === 0x0a))) return null;
  try {
    parsePamHeader(data);
    return { formatId: PAM_DEFINITION.id, confidence: 1, reason: "Structured P7 PAM header" };
  } catch {
    return null;
  }
}

function analyzePam(image: RgbaImage | RetroImageDocument, target: CodecTarget): AnalysisResult {
  const issues: AnalysisIssue[] = [];
  if ("kind" in image) {
    try { validatePamDocument(image, target.modeId); }
    catch (error) {
      issues.push({ severity: "error", code: "SAMPLE_LAYOUT", message: error instanceof Error ? error.message : String(error), rule: "samples" });
    }
  }
  if (!target.modeId.endsWith("-alpha") && hasTransparency("kind" in image ? image.preview : image)) {
    issues.push({ severity: "error", code: "ALPHA_UNSUPPORTED", message: "PAM target does not support alpha", rule: "transparency" });
  }
  return { valid: issues.length === 0, target, issues };
}

interface PfmHeader {
  modeId: "grayscale" | "rgb";
  width: number;
  height: number;
  scaleFactor: number;
  byteOrder: PfmByteOrder;
  rasterStart: number;
}

class PfmScanner {
  offset = 0;

  constructor(readonly data: Uint8Array) {}

  token(): string | null {
    while (this.offset < this.data.length && isSpace(this.data[this.offset]!)) this.offset += 1;
    if (this.offset >= this.data.length) return null;
    const start = this.offset;
    while (this.offset < this.data.length && !isSpace(this.data[this.offset]!)) {
      const byte = this.data[this.offset]!;
      if (byte < 0x21 || byte > 0x7e) throw new RetroImageError("INVALID_FILE", "PFM header contains a non-ASCII token");
      this.offset += 1;
    }
    return ascii(this.data.subarray(start, this.offset));
  }

  rasterStart(): number {
    if (this.offset >= this.data.length || !isSpace(this.data[this.offset]!)) {
      throw new RetroImageError("INVALID_FILE", "PFM header is missing its raster separator");
    }
    const first = this.data[this.offset++]!;
    if (first === 0x0d && this.data[this.offset] === 0x0a) this.offset += 1;
    return this.offset;
  }
}

function parsePfmHeader(data: Uint8Array): PfmHeader {
  const scanner = new PfmScanner(data);
  const magic = scanner.token();
  if (magic !== "PF" && magic !== "Pf") throw new RetroImageError("INVALID_FILE", "Expected a PF or Pf header");
  const width = positiveInteger(scanner.token(), "PFM width");
  const height = positiveInteger(scanner.token(), "PFM height");
  const scale = scanner.token();
  if (scale === null || !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(scale)) {
    throw new RetroImageError("INVALID_FILE", "PFM scale factor must be a finite nonzero number");
  }
  const signedScale = Number(scale);
  if (!Number.isFinite(signedScale) || signedScale === 0) throw new RetroImageError("INVALID_FILE", "PFM scale factor must be a finite nonzero number");
  return {
    modeId: magic === "PF" ? "rgb" : "grayscale",
    width,
    height,
    scaleFactor: Math.abs(signedScale),
    byteOrder: signedScale < 0 ? "little-endian" : "big-endian",
    rasterStart: scanner.rasterStart()
  };
}

function pfmPreview(
  samples: Float32Array,
  width: number,
  height: number,
  channelCount: 1 | 3,
  scaleFactor: number,
  exposure: number,
  toneMapping: PfmToneMapping
): RgbaImage {
  const data = new Uint8ClampedArray(width * height * 4);
  const multiplier = scaleFactor * 2 ** exposure;
  for (let pixel = 0; pixel < width * height; pixel += 1) {
    const linear = channelCount === 1
      ? [Math.max(0, samples[pixel]! * multiplier)]
      : [0, 1, 2].map((channel) => Math.max(0, samples[pixel * 3 + channel]! * multiplier));
    let mapped: number[];
    if (toneMapping === "clip") mapped = linear.map((value) => Math.min(1, value));
    else if (channelCount === 1) mapped = [linear[0]! / (1 + linear[0]!)];
    else {
      const luminance = 0.2126 * linear[0]! + 0.7152 * linear[1]! + 0.0722 * linear[2]!;
      mapped = linear.map((value) => Math.min(1, value / (1 + luminance)));
    }
    const target = pixel * 4;
    for (let channel = 0; channel < 3; channel += 1) {
      data[target + channel] = linearToSrgb(mapped[channelCount === 1 ? 0 : channel]!);
    }
    data[target + 3] = 255;
  }
  return { width, height, data };
}

async function decodePfm(data: Uint8Array, options: DecodeOptions): Promise<FloatSampledRasterDocument> {
  const header = parsePfmHeader(data);
  const channelCount = header.modeId === "rgb" ? 3 : 1;
  const count = checkedSampleCount(header.width, header.height, channelCount, options);
  const expectedEnd = header.rasterStart + count * 4;
  if (!Number.isSafeInteger(expectedEnd) || expectedEnd > data.length) throw new RetroImageError("INVALID_FILE", "PFM raster is truncated");
  if (expectedEnd < data.length) throw new RetroImageError("INVALID_FILE", "Unexpected data after the PFM raster");
  const rowOrder: PfmRowOrder = options.pfm?.rowOrder ?? "bottom-up";
  const samples = new Float32Array(count);
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const rowSamples = header.width * channelCount;
  let negativeSamples = 0;
  for (let fileRow = 0; fileRow < header.height; fileRow += 1) {
    const targetRow = rowOrder === "bottom-up" ? header.height - 1 - fileRow : fileRow;
    for (let index = 0; index < rowSamples; index += 1) {
      const sourceOffset = header.rasterStart + (fileRow * rowSamples + index) * 4;
      const value = view.getFloat32(sourceOffset, header.byteOrder === "little-endian");
      if (!Number.isFinite(value)) throw new RetroImageError("INVALID_FILE", "PFM samples must be finite Float32 values");
      if (value < 0) negativeSamples += 1;
      samples[targetRow * rowSamples + index] = value;
    }
  }
  const warnings = negativeSamples === 0 ? [] : [{
    code: "PFM_NEGATIVE_PREVIEW_CLIPPED",
    message: `Clipped ${negativeSamples} negative PFM ${negativeSamples === 1 ? "sample" : "samples"} for the RGBA preview.`,
    details: { samples: negativeSamples }
  }];
  return {
    kind: "sampled-raster",
    formatId: PFM_DEFINITION.id,
    modeId: header.modeId,
    width: header.width,
    height: header.height,
    pixelAspect: { numerator: 1, denominator: 1 },
    displayProfile: options.displayProfile ?? { hardware: "generic" },
    palette: [],
    preview: pfmPreview(samples, header.width, header.height, channelCount, header.scaleFactor, options.pfm?.exposure ?? 0, options.pfm?.toneMapping ?? "reinhard"),
    components: {},
    metadata: {},
    warnings,
    preserved: [],
    sampleType: "float32",
    channelModel: header.modeId,
    channelCount,
    samples,
    scaleFactor: header.scaleFactor,
    byteOrder: header.byteOrder,
    rowOrder
  };
}

function validatePfmDocument(document: RetroImageDocument, modeId: string): FloatSampledRasterDocument {
  if (modeId !== "grayscale" && modeId !== "rgb") throw new RetroImageError("UNSUPPORTED_MODE", `Unknown PFM mode ${modeId}`);
  if (document.kind !== "sampled-raster" || document.sampleType !== "float32") {
    throw new RetroImageError("VALIDATION_FAILED", "PFM requires Float32 sampled raster data");
  }
  const channels = modeId === "rgb" ? 3 : 1;
  if (document.channelModel !== modeId || document.channelCount !== channels || document.samples.length !== document.width * document.height * channels) {
    throw new RetroImageError("VALIDATION_FAILED", "PFM channel layout is invalid");
  }
  if (!Number.isFinite(document.scaleFactor) || document.scaleFactor <= 0 || document.samples.some((sample) => !Number.isFinite(sample))) {
    throw new RetroImageError("VALIDATION_FAILED", "PFM scale and samples must be finite");
  }
  return document;
}

async function encodePfm(document: RetroImageDocument, options: EncodeOptions): Promise<EncodeResult> {
  const modeId = options.target?.modeId ?? document.modeId;
  const sampled = validatePfmDocument(document, modeId);
  const rowOrder = options.pfm?.rowOrder ?? sampled.rowOrder;
  const byteOrder = options.pfm?.byteOrder ?? sampled.byteOrder;
  const scaleFactor = options.pfm?.scaleFactor ?? sampled.scaleFactor;
  if (!Number.isFinite(scaleFactor) || scaleFactor <= 0) throw new RetroImageError("INVALID_OPTION", "PFM scaleFactor must be finite and positive");
  const sign = byteOrder === "little-endian" ? -1 : 1;
  const pfmHeader = asciiBytes(`${modeId === "rgb" ? "PF" : "Pf"}\n${sampled.width} ${sampled.height}\n${sign * scaleFactor}\n`);
  const raster = new Uint8Array(sampled.samples.length * 4);
  const view = new DataView(raster.buffer);
  const rowSamples = sampled.width * sampled.channelCount;
  for (let fileRow = 0; fileRow < sampled.height; fileRow += 1) {
    const sourceRow = rowOrder === "bottom-up" ? sampled.height - 1 - fileRow : fileRow;
    for (let index = 0; index < rowSamples; index += 1) {
      view.setFloat32((fileRow * rowSamples + index) * 4, sampled.samples[sourceRow * rowSamples + index]!, byteOrder === "little-endian");
    }
  }
  return { data: concat([pfmHeader, raster]), formatId: PFM_DEFINITION.id, warnings: [] };
}

function probePfm(data: Uint8Array, _context: ProbeContext) {
  if (data[0] !== 0x50 || (data[1] !== 0x46 && data[1] !== 0x66)) return null;
  try {
    parsePfmHeader(data);
    return { formatId: PFM_DEFINITION.id, confidence: 1, reason: `${data[1] === 0x46 ? "PF" : "Pf"} PFM header` };
  } catch {
    return null;
  }
}

function analyzePfm(image: RgbaImage | RetroImageDocument, target: CodecTarget): AnalysisResult {
  const issues: AnalysisIssue[] = [];
  if ("kind" in image) {
    try { validatePfmDocument(image, target.modeId); }
    catch (error) {
      issues.push({ severity: "error", code: "SAMPLE_LAYOUT", message: error instanceof Error ? error.message : String(error), rule: "samples" });
    }
  }
  if (hasTransparency("kind" in image ? image.preview : image)) {
    issues.push({ severity: "error", code: "ALPHA_UNSUPPORTED", message: "PFM does not support alpha", rule: "transparency" });
  }
  return { valid: issues.length === 0, target, issues };
}

async function decodePnm(expectedFamily: PnmFamily, data: Uint8Array, options: DecodeOptions): Promise<IntegerSampledRasterDocument> {
  const scanner = new NetpbmScanner(data);
  const parsed = familyForMagic(scanner.token() ?? "");
  if (!parsed || parsed.family !== expectedFamily) throw new RetroImageError("INVALID_FILE", `Expected a ${expectedFamily.toUpperCase()} image`);
  const width = positiveInteger(scanner.token(), "width");
  const height = positiveInteger(scanner.token(), "height");
  const channels = expectedFamily === "ppm" ? 3 : 1;
  checkedSampleCount(width, height, channels, options);
  const maxval = expectedFamily === "pbm" ? 1 : positiveInteger(scanner.token(), "maxval");
  if (maxval > 65_535) throw new RetroImageError("INVALID_FILE", "Netpbm maxval must not exceed 65535");
  const samples = parsed.mode === "plain"
    ? readPlainSamples(scanner, width * height * channels, maxval)
    : readRawSamples(
      data,
      scanner.rawRasterStart(expectedFamily === "pbm" ? Math.ceil(width / 8) * height : width * height * channels * (maxval < 256 ? 1 : 2)),
      expectedFamily,
      width,
      height,
      channels,
      maxval
    );
  const channelModel: SampleChannelModel = expectedFamily === "pbm" ? "black-and-white" : expectedFamily === "pgm" ? "grayscale" : "rgb";
  return {
    kind: "sampled-raster",
    formatId: `netpbm.${expectedFamily}`,
    modeId: parsed.mode,
    width,
    height,
    pixelAspect: { numerator: 1, denominator: 1 },
    displayProfile: options.displayProfile ?? { hardware: "generic" },
    palette: [],
    preview: integerPreview(samples, width, height, channelModel, maxval, expectedFamily === "pbm"),
    components: {},
    metadata: { netpbmComments: scanner.comments },
    warnings: [],
    preserved: [],
    sampleType: "uint",
    channelModel,
    channelCount: channels,
    samples,
    maxSampleValue: maxval
  };
}

function commentsOf(document: RetroImageDocument): string[] {
  const value = document.metadata.netpbmComments;
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string" || /[\r\n\0]/.test(entry))) {
    throw new RetroImageError("VALIDATION_FAILED", "netpbmComments must contain single-line strings");
  }
  return value as string[];
}

function header(magic: string, comments: string[], width: number, height: number, maxval?: number): Uint8Array {
  const lines = [magic, ...comments.map((comment) => `#${comment}`), `${width} ${height}`];
  if (maxval !== undefined) lines.push(String(maxval));
  return asciiBytes(`${lines.join("\n")}\n`);
}

function plainRaster(samples: Uint16Array, width: number, channels: number): Uint8Array {
  const lines: string[] = [];
  let line = "";
  for (let index = 0; index < samples.length; index += 1) {
    const token = String(samples[index]);
    if (line.length > 0 && line.length + 1 + token.length > 70) {
      lines.push(line);
      line = token;
    } else {
      line += `${line.length === 0 ? "" : " "}${token}`;
    }
    if ((index + 1) % (width * channels) === 0) {
      lines.push(line);
      line = "";
    }
  }
  if (line.length > 0) lines.push(line);
  return asciiBytes(`${lines.join("\n")}\n`);
}

function rawRaster(document: IntegerSampledRasterDocument, family: PnmFamily): Uint8Array {
  if (family === "pbm") {
    const rowBytes = Math.ceil(document.width / 8);
    const data = new Uint8Array(rowBytes * document.height);
    for (let y = 0; y < document.height; y += 1) {
      for (let x = 0; x < document.width; x += 1) {
        if (document.samples[y * document.width + x] === 1) data[y * rowBytes + (x >>> 3)]! |= 0x80 >>> (x & 7);
      }
    }
    return data;
  }
  const bytesPerSample = document.maxSampleValue < 256 ? 1 : 2;
  const data = new Uint8Array(document.samples.length * bytesPerSample);
  let offset = 0;
  for (const sample of document.samples) {
    if (bytesPerSample === 1) data[offset++] = sample;
    else {
      data[offset++] = sample >>> 8;
      data[offset++] = sample;
    }
  }
  return data;
}

function validateIntegerDocument(document: RetroImageDocument, family: PnmFamily): IntegerSampledRasterDocument {
  if (document.kind !== "sampled-raster" || document.sampleType !== "uint") {
    throw new RetroImageError("VALIDATION_FAILED", `${family.toUpperCase()} requires unsigned sampled raster data`);
  }
  const channels = family === "ppm" ? 3 : 1;
  const model = family === "pbm" ? "black-and-white" : family === "pgm" ? "grayscale" : "rgb";
  const maxval = family === "pbm" ? 1 : document.maxSampleValue;
  if (document.channelCount !== channels || document.channelModel !== model || document.samples.length !== document.width * document.height * channels) {
    throw new RetroImageError("VALIDATION_FAILED", `${family.toUpperCase()} channel layout is invalid`);
  }
  if (!Number.isInteger(maxval) || maxval < 1 || maxval > 65_535 || document.samples.some((sample) => sample > maxval)) {
    throw new RetroImageError("VALIDATION_FAILED", `${family.toUpperCase()} sample range is invalid`);
  }
  return document;
}

async function encodePnm(family: PnmFamily, document: RetroImageDocument, options: EncodeOptions): Promise<EncodeResult> {
  const sampled = validateIntegerDocument(document, family);
  const mode = options.target?.modeId ?? sampled.modeId;
  if (mode !== "plain" && mode !== "raw") throw new RetroImageError("UNSUPPORTED_MODE", `Unknown ${family.toUpperCase()} mode ${mode}`);
  const maxval = family === "pbm" ? undefined : sampled.maxSampleValue;
  const channels = family === "ppm" ? 3 : 1;
  const output = concat([
    header(magicFor(family, mode), commentsOf(sampled), sampled.width, sampled.height, maxval),
    mode === "plain" ? plainRaster(sampled.samples, sampled.width, channels) : rawRaster(sampled, family)
  ]);
  return { data: output, formatId: `netpbm.${family}`, warnings: [] };
}

function analyzePnm(family: PnmFamily, image: RgbaImage | RetroImageDocument, target: CodecTarget): AnalysisResult {
  const issues: AnalysisIssue[] = [];
  if (image.width < 1 || image.height < 1 || image.width * image.height > 16_777_216) {
    issues.push({ severity: "error", code: "DIMENSIONS_MISMATCH", message: "Netpbm dimensions are outside supported limits", rule: "dimensions" });
  }
  if ("kind" in image) {
    try { validateIntegerDocument(image, family); }
    catch (error) {
      issues.push({ severity: "error", code: "SAMPLE_LAYOUT", message: error instanceof Error ? error.message : String(error), rule: "samples" });
    }
  }
  if (hasTransparency("kind" in image ? image.preview : image)) {
    issues.push({ severity: "error", code: "ALPHA_UNSUPPORTED", message: `${family.toUpperCase()} does not support alpha`, rule: "transparency" });
  }
  return { valid: issues.length === 0, target, issues };
}

function hasTransparency(image: RgbaImage): boolean {
  for (let offset = 3; offset < image.data.length; offset += 4) if (image.data[offset] !== 255) return true;
  return false;
}

function targetHasAlpha(formatId: string, modeId: string): boolean {
  return formatId === PAM_DEFINITION.id && modeId.endsWith("-alpha");
}

function targetIsBilevel(formatId: string, modeId: string): boolean {
  return formatId === PBM_DEFINITION.id || (formatId === PAM_DEFINITION.id && modeId.startsWith("black-and-white"));
}

interface LinearPixels {
  rgb: Float64Array;
  alpha: Float64Array;
  composed: boolean;
}

function linearPixels(source: RgbaImage, keepAlpha: boolean, background: ConversionOptions["background"]): LinearPixels {
  const transparent = hasTransparency(source);
  if (!keepAlpha && transparent && background === undefined) {
    throw new RetroImageError("VALIDATION_FAILED", "A background color is required when converting transparency to a target without alpha");
  }
  if (background?.a !== undefined && background.a !== 255) throw new RetroImageError("INVALID_OPTION", "Conversion background must be opaque");
  const bg = background ?? { r: 0, g: 0, b: 0 };
  const bgLinear = [bg.r, bg.g, bg.b].map((value) => srgbToLinear(value / 255));
  const rgb = new Float64Array(source.width * source.height * 3);
  const alpha = new Float64Array(source.width * source.height);
  for (let pixel = 0; pixel < source.width * source.height; pixel += 1) {
    const sourceOffset = pixel * 4;
    const opacity = source.data[sourceOffset + 3]! / 255;
    alpha[pixel] = opacity;
    for (let channel = 0; channel < 3; channel += 1) {
      const foreground = srgbToLinear(source.data[sourceOffset + channel]! / 255);
      rgb[pixel * 3 + channel] = keepAlpha ? foreground : foreground * opacity + bgLinear[channel]! * (1 - opacity);
    }
  }
  return { rgb, alpha, composed: transparent && !keepAlpha };
}

const BAYER_2 = [[0, 2], [3, 1]];
const BAYER_4 = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]];

function bilevelWhites(luminance: Float64Array, width: number, height: number, dither: ConversionOptions["dither"]): Uint8Array {
  const output = new Uint8Array(luminance.length);
  if (dither === "floyd-steinberg") {
    const work = Float64Array.from(luminance);
    for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      const white = work[index]! >= 0.5 ? 1 : 0;
      output[index] = white;
      const error = work[index]! - white;
      const spread = (nx: number, ny: number, weight: number): void => {
        if (nx >= 0 && nx < width && ny < height) {
          const next = ny * width + nx;
          work[next] = work[next]! + error * weight;
        }
      };
      spread(x + 1, y, 7 / 16);
      spread(x - 1, y + 1, 3 / 16);
      spread(x, y + 1, 5 / 16);
      spread(x + 1, y + 1, 1 / 16);
    }
    return output;
  }
  const matrix = dither === "bayer2" ? BAYER_2 : dither === "bayer4" ? BAYER_4 : undefined;
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    const threshold = matrix ? (matrix[y % matrix.length]![x % matrix.length]! + 0.5) / (matrix.length * matrix.length) : 0.5;
    output[y * width + x] = luminance[y * width + x]! >= threshold ? 1 : 0;
  }
  return output;
}

async function convertNetpbm(
  formatId: string,
  image: RgbaImage | RetroImageDocument,
  target: CodecTarget,
  options: ConversionOptions
): Promise<ConversionResult> {
  const source = "kind" in image ? image.preview : image;
  const alphaTarget = targetHasAlpha(formatId, target.modeId);
  const bilevel = targetIsBilevel(formatId, target.modeId);
  if (!bilevel && options.dither !== undefined && options.dither !== "none") {
    throw new RetroImageError("INVALID_OPTION", "Dithering is supported only for bilevel Netpbm targets");
  }
  if (formatId === PFM_DEFINITION.id && options.maxSampleValue !== undefined) {
    throw new RetroImageError("INVALID_OPTION", "PFM conversion does not use maxSampleValue");
  }
  const maxval = bilevel ? 1 : options.maxSampleValue ?? 255;
  if (!Number.isInteger(maxval) || maxval < 1 || maxval > 65_535) {
    throw new RetroImageError("INVALID_OPTION", "maxSampleValue must be an integer from 1 through 65535");
  }
  if (bilevel && options.maxSampleValue !== undefined && options.maxSampleValue !== 1) {
    throw new RetroImageError("INVALID_OPTION", "Bilevel targets require maxSampleValue 1");
  }
  const linear = linearPixels(source, alphaTarget, options.background);
  const luminance = new Float64Array(source.width * source.height);
  for (let pixel = 0; pixel < luminance.length; pixel += 1) {
    luminance[pixel] = 0.2126 * linear.rgb[pixel * 3]! + 0.7152 * linear.rgb[pixel * 3 + 1]! + 0.0722 * linear.rgb[pixel * 3 + 2]!;
  }
  const steps = [{ operation: "color-space", message: "Converted sRGB input to target sample space" }];
  if (linear.composed) steps.push({ operation: "alpha-composite", message: "Composited transparency over the explicit background" });

  if (formatId === PFM_DEFINITION.id) {
    if (target.modeId !== "rgb" && target.modeId !== "grayscale") throw new RetroImageError("UNSUPPORTED_MODE", `Unknown PFM mode ${target.modeId}`);
    const modeId: "rgb" | "grayscale" = target.modeId;
    const channelCount = modeId === "rgb" ? 3 : 1;
    const samples = new Float32Array(source.width * source.height * channelCount);
    for (let pixel = 0; pixel < source.width * source.height; pixel += 1) {
      if (channelCount === 1) samples[pixel] = luminance[pixel]!;
      else for (let channel = 0; channel < 3; channel += 1) samples[pixel * 3 + channel] = linear.rgb[pixel * 3 + channel]!;
    }
    const document: FloatSampledRasterDocument = {
      kind: "sampled-raster", formatId, modeId, width: source.width, height: source.height,
      pixelAspect: { numerator: 1, denominator: 1 }, displayProfile: target.displayProfile, palette: [],
      preview: pfmPreview(samples, source.width, source.height, channelCount, 1, 0, "reinhard"), components: {}, metadata: {}, warnings: [], preserved: [],
      sampleType: "float32", channelModel: modeId, channelCount, samples,
      scaleFactor: 1, byteOrder: "little-endian", rowOrder: "bottom-up"
    };
    return { document, report: { target, steps, warnings: [] } };
  }

  let channelModel: SampleChannelModel;
  let channelCount: 1 | 2 | 3 | 4;
  if (formatId === PBM_DEFINITION.id) {
    if (target.modeId !== "plain" && target.modeId !== "raw") throw new RetroImageError("UNSUPPORTED_MODE", `Unknown PBM mode ${target.modeId}`);
    channelModel = "black-and-white";
    channelCount = 1;
  } else if (formatId === PGM_DEFINITION.id) {
    if (target.modeId !== "plain" && target.modeId !== "raw") throw new RetroImageError("UNSUPPORTED_MODE", `Unknown PGM mode ${target.modeId}`);
    channelModel = "grayscale";
    channelCount = 1;
  } else if (formatId === PPM_DEFINITION.id) {
    if (target.modeId !== "plain" && target.modeId !== "raw") throw new RetroImageError("UNSUPPORTED_MODE", `Unknown PPM mode ${target.modeId}`);
    channelModel = "rgb";
    channelCount = 3;
  } else {
    if (!(target.modeId in PAM_LAYOUTS)) throw new RetroImageError("UNSUPPORTED_MODE", `Unknown PAM mode ${target.modeId}`);
    const layout = PAM_LAYOUTS[target.modeId as PamMode];
    channelModel = layout.channelModel;
    channelCount = layout.channelCount;
  }
  const samples = new Uint16Array(source.width * source.height * channelCount);
  if (bilevel) {
    const whites = bilevelWhites(luminance, source.width, source.height, options.dither ?? "none");
    for (let pixel = 0; pixel < whites.length; pixel += 1) {
      samples[pixel * channelCount] = formatId === PBM_DEFINITION.id ? 1 - whites[pixel]! : whites[pixel]!;
      if (channelCount === 2) samples[pixel * 2 + 1] = Math.round(linear.alpha[pixel]!);
    }
    if ((options.dither ?? "none") !== "none") steps.push({ operation: "dither", message: `Applied ${options.dither} bilevel dithering` });
  } else if (channelModel.startsWith("grayscale")) {
    for (let pixel = 0; pixel < source.width * source.height; pixel += 1) {
      samples[pixel * channelCount] = Math.round(linearToBt709(luminance[pixel]!) * maxval);
      if (channelCount === 2) samples[pixel * 2 + 1] = Math.round(linear.alpha[pixel]! * maxval);
    }
  } else {
    for (let pixel = 0; pixel < source.width * source.height; pixel += 1) {
      for (let channel = 0; channel < 3; channel += 1) samples[pixel * channelCount + channel] = Math.round(linearToBt709(linear.rgb[pixel * 3 + channel]!) * maxval);
      if (channelCount === 4) samples[pixel * 4 + 3] = Math.round(linear.alpha[pixel]! * maxval);
    }
  }
  const integerDocument: IntegerSampledRasterDocument = {
    kind: "sampled-raster", formatId, modeId: target.modeId, width: source.width, height: source.height,
    pixelAspect: { numerator: 1, denominator: 1 }, displayProfile: target.displayProfile, palette: [],
    preview: { width: source.width, height: source.height, data: new Uint8ClampedArray(source.width * source.height * 4) },
    components: {}, metadata: { netpbmComments: [] }, warnings: [], preserved: [],
    sampleType: "uint", channelModel, channelCount, samples, maxSampleValue: maxval
  };
  integerDocument.preview = formatId === PAM_DEFINITION.id
    ? pamPreview(integerDocument)
    : integerPreview(samples, source.width, source.height, channelModel as "black-and-white" | "grayscale" | "rgb", maxval, formatId === PBM_DEFINITION.id);
  steps.push({ operation: "sample-depth", message: `Generated ${maxval === 1 ? "bilevel" : `maxval ${maxval}`} samples` });
  return { document: integerDocument, report: { target, steps, warnings: [] } };
}

function probePnm(family: PnmFamily, data: Uint8Array, _context: ProbeContext) {
  if (data[0] !== 0x50 || data[1] === undefined) return null;
  const parsed = familyForMagic(`P${String.fromCharCode(data[1])}`);
  return parsed?.family === family
    ? { formatId: `netpbm.${family}`, confidence: 1, reason: `${magicFor(family, parsed.mode)} ${family.toUpperCase()} magic` }
    : null;
}

function pnmPlugin(family: PnmFamily, definition: FormatDefinition): FormatPlugin {
  return {
    definition,
    probe: (data, context) => probePnm(family, data, context),
    decode: (data, options) => decodePnm(family, data, options),
    encode: (document, options) => encodePnm(family, document, options),
    analyze: (image, target) => analyzePnm(family, image, target),
    convert: (image, target, options) => convertNetpbm(definition.id, image, target, options)
  };
}

export const netpbmPbmPlugin = pnmPlugin("pbm", PBM_DEFINITION);
export const netpbmPgmPlugin = pnmPlugin("pgm", PGM_DEFINITION);
export const netpbmPpmPlugin = pnmPlugin("ppm", PPM_DEFINITION);
export const netpbmPamPlugin: FormatPlugin = {
  definition: PAM_DEFINITION,
  probe: probePam,
  decode: decodePam,
  encode: encodePam,
  analyze: analyzePam,
  convert: (image, target, options) => convertNetpbm(PAM_DEFINITION.id, image, target, options)
};
export const netpbmPfmPlugin: FormatPlugin = {
  definition: PFM_DEFINITION,
  probe: probePfm,
  decode: decodePfm,
  encode: encodePfm,
  analyze: analyzePfm,
  convert: (image, target, options) => convertNetpbm(PFM_DEFINITION.id, image, target, options)
};

export const netpbmPlugins: FormatPlugin[] = [netpbmPbmPlugin, netpbmPgmPlugin, netpbmPpmPlugin, netpbmPamPlugin, netpbmPfmPlugin];
