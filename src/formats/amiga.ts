import { BinaryReader, BinaryWriter, DEFAULT_LIMITS, extensionOf } from "../core/binary";
import { colorDistance, indexedToRgba, rgb12 } from "../core/color";
import { analyzeDimensions, genericConvert, imagePreview, isRgbOnComponentGrid, mapToPalette, prepareConversionImage, quantizeRgbToComponentGrid, resolveRgbComponentPrecision } from "../core/conversion";
import { RetroImageError } from "../core/errors";
import type {
  AmigaPlanarLayout,
  AnalysisIssue,
  AnalysisResult,
  CodecTarget,
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
import { rasterDocument } from "./common";

const HIRES = 0x8000;
const SUPERHIRES = 0x0020;
const HAM = 0x0800;
const HALFBRITE = 0x0080;
const LACE = 0x0004;

function displayVariants(resolution: "low" | "high" | "super-high", hardwareProfiles: string[]) {
  const width = resolution === "low" ? 320 : resolution === "high" ? 640 : 1280;
  const x = resolution === "low" ? 44 : resolution === "high" ? 22 : 11;
  return ([
    ["pal", false, 44, 256], ["pal", true, 22, 512],
    ["ntsc", false, 52, 200], ["ntsc", true, 26, 400]
  ] as const).map(([videoStandard, interlaced, y, height]) => ({
    id: `${videoStandard}-${interlaced ? "laced" : "non-laced"}`,
    label: `${videoStandard.toUpperCase()} ${interlaced ? "Laced" : "non-laced"}`,
    hardwareProfiles, videoStandard, interlaced,
    nominalPageSize: { width, height }, pixelAspect: { numerator: x, denominator: y }
  }));
}

function indexedMode(id: string, label: string, resolutionClass: "low" | "high" | "super-high", bitsPerPixel: number, displayColorLimit: number, storableColorEntries: number, componentBits: number, hardwareProfiles: string[], model: "programmable-indexed" | "derived-indexed" = "programmable-indexed"): FormatModeDefinition {
  const variants = displayVariants(resolutionClass, hardwareProfiles);
  return {
    id, label, dimensions: [],
    dimensionRange: { minWidth: 1, maxWidth: hardwareProfiles.includes("aga") ? 16384 : 4096, minHeight: 1, maxHeight: hardwareProfiles.includes("aga") ? 16384 : 4096 },
    pixelAspect: variants[0]!.pixelAspect, colorModel: "indexed", bitsPerPixel, maxColors: displayColorLimit,
    paletteBitsPerChannel: componentBits,
    palette: { model, displayColorLimit, storableColorEntries, componentPrecision: [{ hardwareProfiles, redBits: componentBits, greenBits: componentBits, blueBits: componentBits }] },
    resolutionClass, interlaceSupport: "optional", displayVariants: variants,
    hardwareProfiles, videoStandards: ["pal", "ntsc"], supportsTransparency: true
  };
}

const amigaModes: FormatModeDefinition[] = [
  indexedMode("ocs-indexed", "OCS/ECS Lowres indexed", "low", 5, 32, 32, 4, ["ocs", "ecs"]),
  indexedMode("ocs-hires-indexed", "OCS/ECS Hires indexed", "high", 4, 16, 16, 4, ["ocs", "ecs"]),
  indexedMode("ocs-ehb", "OCS/ECS Extra Half-Brite Lowres", "low", 6, 64, 32, 4, ["ocs", "ecs"], "derived-indexed"),
  indexedMode("ecs-superhires-indexed", "ECS SuperHires indexed", "super-high", 2, 4, 4, 2, ["ecs"]),
  indexedMode("aga-indexed", "AGA Lowres indexed", "low", 8, 256, 256, 8, ["aga"]),
  indexedMode("aga-hires-indexed", "AGA Hires indexed", "high", 8, 256, 256, 8, ["aga"]),
  indexedMode("aga-superhires-indexed", "AGA SuperHires indexed", "super-high", 8, 256, 256, 8, ["aga"]),
  { id: "ocs-ham6", label: "OCS/ECS HAM6 Lowres", dimensions: [], dimensionRange: { minWidth: 1, maxWidth: 4096, minHeight: 1, maxHeight: 4096 }, pixelAspect: { numerator: 44, denominator: 44 }, colorModel: "ham", bitsPerPixel: 6, maxColors: 4096, paletteBitsPerChannel: 4, palette: { model: "programmable-indexed", displayColorLimit: 4096, storableColorEntries: 16, componentPrecision: [{ hardwareProfiles: ["ocs", "ecs"], redBits: 4, greenBits: 4, blueBits: 4 }] }, resolutionClass: "low", interlaceSupport: "optional", displayVariants: displayVariants("low", ["ocs", "ecs"]), hardwareProfiles: ["ocs", "ecs"], videoStandards: ["pal", "ntsc"], supportsTransparency: true },
  { id: "aga-ham8", label: "AGA HAM8 Lowres", dimensions: [], dimensionRange: { minWidth: 1, maxWidth: 16384, minHeight: 1, maxHeight: 16384 }, pixelAspect: { numerator: 44, denominator: 44 }, colorModel: "ham", bitsPerPixel: 8, maxColors: 262144, paletteBitsPerChannel: 8, palette: { model: "programmable-indexed", displayColorLimit: 262144, storableColorEntries: 64, componentPrecision: [{ hardwareProfiles: ["aga"], redBits: 8, greenBits: 8, blueBits: 8 }] }, resolutionClass: "low", interlaceSupport: "optional", displayVariants: displayVariants("low", ["aga"]), hardwareProfiles: ["aga"], videoStandards: ["pal", "ntsc"], supportsTransparency: true }
];

const ilbmDefinition: FormatDefinition = {
  schemaVersion: 1,
  id: "amiga.ilbm",
  label: "Amiga IFF ILBM",
  platform: "Amiga OCS/ECS/AGA",
  extensions: ["iff", "ilbm", "lbm"],
  mimeTypes: ["image/x-ilbm", "image/iff"],
  canDecode: true,
  canEncode: true,
  raw: false,
  modes: amigaModes,
  encodingVariants: [
    { id: "uncompressed", label: "Uncompressed ILBM", encodeOptions: { compression: "none" } },
    { id: "byterun1", label: "ByteRun1 ILBM", encodeOptions: { compression: "byterun1" } }
  ]
};

const rawDefinition: FormatDefinition = {
  ...ilbmDefinition,
  id: "amiga.raw-planar",
  label: "Amiga raw planar bitmap",
  extensions: ["raw", "bin"],
  mimeTypes: ["application/octet-stream"],
  raw: true,
  encodingVariants: [
    { id: "row-interleaved", label: "Row-interleaved planar", encodeOptions: { amigaPlanar: { layout: "row-interleaved" } } },
    { id: "plane-major", label: "Plane-major planar", encodeOptions: { amigaPlanar: { layout: "plane-major" } } }
  ]
};

interface IlbmHeader {
  width: number;
  height: number;
  x: number;
  y: number;
  planes: number;
  masking: number;
  compression: number;
  transparentColor: number;
  xAspect: number;
  yAspect: number;
  pageWidth: number;
  pageHeight: number;
}

function parseHeader(data: Uint8Array): IlbmHeader {
  if (data.length < 20) throw new RetroImageError("INVALID_FILE", "ILBM BMHD chunk is truncated");
  const reader = new BinaryReader(data);
  return {
    width: reader.u16be(), height: reader.u16be(), x: reader.i16be(), y: reader.i16be(),
    planes: reader.u8(), masking: reader.u8(), compression: reader.u8(),
    transparentColor: (reader.u8(), reader.u16be()),
    xAspect: reader.u8(), yAspect: reader.u8(), pageWidth: reader.i16be(), pageHeight: reader.i16be()
  };
}

function decodeByteRun1(source: Uint8Array, expected: number, maxBytes: number, rowBytes = expected): Uint8Array {
  if (expected > maxBytes) throw new RetroImageError("LIMIT_EXCEEDED", "ILBM decompressed BODY exceeds the configured limit");
  const output = new Uint8Array(expected);
  let input = 0;
  let offset = 0;
  let rowOffset = 0;
  while (input < source.length && offset < expected) {
    const control = source[input++]!;
    const signed = control > 127 ? control - 256 : control;
    if (signed >= 0) {
      const count = signed + 1;
      if (input + count > source.length || offset + count > expected || rowOffset + count > rowBytes) throw new RetroImageError("INVALID_FILE", "Invalid ByteRun1 literal run or plane-row crossing");
      output.set(source.subarray(input, input + count), offset);
      input += count;
      offset += count;
      rowOffset = (rowOffset + count) % rowBytes;
    } else if (signed !== -128) {
      const count = 1 - signed;
      if (input >= source.length || offset + count > expected || rowOffset + count > rowBytes) throw new RetroImageError("INVALID_FILE", "Invalid ByteRun1 repeated run or plane-row crossing");
      output.fill(source[input++]!, offset, offset + count);
      offset += count;
      rowOffset = (rowOffset + count) % rowBytes;
    }
  }
  if (offset !== expected) throw new RetroImageError("INVALID_FILE", "ByteRun1 BODY ended before all rows were decoded");
  return output;
}

function encodeByteRun1(source: Uint8Array): Uint8Array {
  const output: number[] = [];
  let offset = 0;
  while (offset < source.length) {
    let run = 1;
    while (offset + run < source.length && run < 128 && source[offset + run] === source[offset]) run += 1;
    if (run >= 3) {
      output.push(257 - run, source[offset]!);
      offset += run;
      continue;
    }
    const start = offset;
    offset += run;
    while (offset < source.length && offset - start < 128) {
      run = 1;
      while (offset + run < source.length && run < 3 && source[offset + run] === source[offset]) run += 1;
      if (run >= 3) break;
      offset += run;
    }
    const count = offset - start;
    output.push(count - 1, ...source.subarray(start, offset));
  }
  return Uint8Array.from(output);
}

function encodeByteRun1Rows(source: Uint8Array, rowBytes: number): Uint8Array {
  const rows: Uint8Array[] = [];
  let length = 0;
  for (let offset = 0; offset < source.length; offset += rowBytes) {
    const row = encodeByteRun1(source.subarray(offset, offset + rowBytes));
    rows.push(row);
    length += row.length;
  }
  const result = new Uint8Array(length);
  let offset = 0;
  for (const row of rows) { result.set(row, offset); offset += row.length; }
  return result;
}

function planeRowOffset(layout: AmigaPlanarLayout, plane: number, y: number, height: number, storedPlanes: number, rowBytes: number): number {
  return layout === "plane-major" ? (plane * height + y) * rowBytes : (y * storedPlanes + plane) * rowBytes;
}

function planarIndices(body: Uint8Array, width: number, height: number, planes: number, masking: number, layout: AmigaPlanarLayout = "row-interleaved"): { indices: Uint8Array; mask?: Uint8Array } {
  const rowBytes = ((width + 15) >>> 4) << 1;
  const storedPlanes = planes + (masking === 1 ? 1 : 0);
  const expected = rowBytes * storedPlanes * height;
  if (body.length < expected) throw new RetroImageError("INVALID_FILE", "ILBM BODY is shorter than its BMHD layout");
  const indices = new Uint8Array(width * height);
  const mask = masking === 1 ? new Uint8Array(width * height) : undefined;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let value = 0;
      for (let plane = 0; plane < planes; plane += 1) {
        const row = planeRowOffset(layout, plane, y, height, storedPlanes, rowBytes);
        const byte = body[row + (x >>> 3)]!;
        if (byte & (0x80 >>> (x & 7))) value |= 1 << plane;
      }
      indices[y * width + x] = value;
      if (mask) {
        const row = planeRowOffset(layout, planes, y, height, storedPlanes, rowBytes);
        mask[y * width + x] = body[row + (x >>> 3)]! & (0x80 >>> (x & 7)) ? 1 : 0;
      }
    }
  }
  return mask ? { indices, mask } : { indices };
}

function packPlanar(indices: Uint8Array, width: number, height: number, planes: number, mask?: Uint8Array, layout: AmigaPlanarLayout = "row-interleaved"): Uint8Array {
  const rowBytes = ((width + 15) >>> 4) << 1;
  const storedPlanes = planes + (mask ? 1 : 0);
  const body = new Uint8Array(rowBytes * storedPlanes * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const value = indices[y * width + x]!;
      for (let plane = 0; plane < planes; plane += 1) {
        if (value & (1 << plane)) {
          const row = planeRowOffset(layout, plane, y, height, storedPlanes, rowBytes);
          body[row + (x >>> 3)]! |= 0x80 >>> (x & 7);
        }
      }
      if (mask?.[y * width + x]) {
        const row = planeRowOffset(layout, planes, y, height, storedPlanes, rowBytes);
        body[row + (x >>> 3)]! |= 0x80 >>> (x & 7);
      }
    }
  }
  return body;
}

function halfbritePalette(palette: RgbColor[]): RgbColor[] {
  const base = palette.slice(0, 32);
  return [...base, ...base.map((color) => ({ r: color.r >>> 1, g: color.g >>> 1, b: color.b >>> 1 }))];
}

function paletteBytes(palette: RgbColor[]): Uint8Array {
  return Uint8Array.from(palette.flatMap(({ r, g, b }) => [r, g, b]));
}

function applyMask(preview: RgbaImage, mask?: Uint8Array): RgbaImage {
  if (mask) for (let pixel = 0; pixel < mask.length; pixel += 1) preview.data[pixel * 4 + 3] = mask[pixel] ? 255 : 0;
  return preview;
}

function imageMask(image: RgbaImage): Uint8Array | undefined {
  const mask = new Uint8Array(image.width * image.height);
  let transparent = false;
  for (let pixel = 0; pixel < mask.length; pixel += 1) {
    mask[pixel] = image.data[pixel * 4 + 3]! >= 128 ? 1 : 0;
    if (!mask[pixel]) transparent = true;
  }
  return transparent ? mask : undefined;
}

function renderHam(indices: Uint8Array, width: number, height: number, palette: RgbColor[], bits: 6 | 8): RgbaImage {
  const dataBits = bits - 2;
  const mask = (1 << dataBits) - 1;
  const scale = 255 / mask;
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    let held: RgbColor = palette[0] ?? { r: 0, g: 0, b: 0 };
    for (let x = 0; x < width; x += 1) {
      const command = indices[y * width + x]!;
      const control = command >>> dataBits;
      const value = Math.round((command & mask) * scale);
      if (control === 0) held = palette[command & mask] ?? held;
      else if (control === 1) held = { ...held, b: value };
      else if (control === 2) held = { ...held, r: value };
      else held = { ...held, g: value };
      const offset = (y * width + x) * 4;
      rgba.set([held.r, held.g, held.b, held.a ?? 255], offset);
    }
  }
  return { width, height, data: rgba };
}

function hamCommands(image: RgbaImage, palette: RgbColor[], bits: 6 | 8): Uint8Array {
  const dataBits = bits - 2;
  const dataMask = (1 << dataBits) - 1;
  const scale = 255 / dataMask;
  const commands = new Uint8Array(image.width * image.height);
  for (let y = 0; y < image.height; y += 1) {
    let held = palette[0] ?? { r: 0, g: 0, b: 0 };
    for (let x = 0; x < image.width; x += 1) {
      const offset = (y * image.width + x) * 4;
      const target = { r: image.data[offset]!, g: image.data[offset + 1]!, b: image.data[offset + 2]! };
      let command = 0;
      let result = palette[0] ?? held;
      let error = Number.POSITIVE_INFINITY;
      for (let index = 0; index < palette.length && index <= dataMask; index += 1) {
        const candidate = palette[index]!;
        const next = colorDistance(target, candidate);
        if (next < error) { error = next; command = index; result = candidate; }
      }
      const componentCandidates: Array<{ control: number; color: RgbColor }> = [
        { control: 1, color: { ...held, b: Math.round(Math.round(target.b / scale) * scale) } },
        { control: 2, color: { ...held, r: Math.round(Math.round(target.r / scale) * scale) } },
        { control: 3, color: { ...held, g: Math.round(Math.round(target.g / scale) * scale) } }
      ];
      for (const candidate of componentCandidates) {
        const next = colorDistance(target, candidate.color);
        if (next < error) {
          error = next;
          const component = candidate.control === 1 ? candidate.color.b : candidate.control === 2 ? candidate.color.r : candidate.color.g;
          command = (candidate.control << dataBits) | Math.round(component / scale);
          result = candidate.color;
        }
      }
      commands[y * image.width + x] = command;
      held = result;
    }
  }
  return commands;
}

function identifyMode(planes: number, camg: number, cmap: Uint8Array, hardware?: string): string {
  const aga = hardware ? hardware === "aga" : planes > 6 || [...cmap].some((value) => value % 17 !== 0);
  if (camg & HAM) {
    if (planes === 6) return "ocs-ham6";
    if (planes === 8) return "aga-ham8";
    throw new RetroImageError("UNSUPPORTED_MODE", `HAM requires exactly 6 or 8 planes, received ${planes}`);
  }
  if (camg & HALFBRITE) return "ocs-ehb";
  if (camg & SUPERHIRES) return aga ? "aga-superhires-indexed" : "ecs-superhires-indexed";
  if (camg & HIRES) return aga ? "aga-hires-indexed" : "ocs-hires-indexed";
  return aga ? "aga-indexed" : "ocs-indexed";
}

function inferDisplayVariant(header: IlbmHeader, camg: number, mode: FormatModeDefinition) {
  const interlaced = Boolean(camg & LACE);
  const matches = mode.displayVariants?.filter((variant) => variant.interlaced === interlaced
    && variant.pixelAspect.numerator === header.xAspect
    && variant.pixelAspect.denominator === header.yAspect
    && variant.nominalPageSize.width === header.pageWidth
    && variant.nominalPageSize.height === header.pageHeight) ?? [];
  return matches.length === 1 ? matches[0] : undefined;
}

function pixelAspect(header: IlbmHeader, camg: number): { numerator: number; denominator: number } {
  if (header.xAspect > 0 && header.yAspect > 0) return { numerator: header.xAspect, denominator: header.yAspect };
  const resolution = camg & SUPERHIRES ? "super-high" : camg & HIRES ? "high" : "low";
  const x = resolution === "low" ? 44 : resolution === "high" ? 22 : 11;
  return { numerator: x, denominator: camg & LACE ? 22 : 44 };
}

function decodeIlbm(data: Uint8Array, options: DecodeOptions): RasterDocument {
  const reader = new BinaryReader(data);
  if (reader.ascii(4) !== "FORM") throw new RetroImageError("INVALID_FILE", "Missing IFF FORM header");
  const formSize = reader.u32be();
  if (reader.ascii(4) !== "ILBM") throw new RetroImageError("INVALID_FILE", "IFF FORM is not ILBM");
  if (formSize + 8 > data.length) throw new RetroImageError("INVALID_FILE", "IFF FORM size exceeds the file");
  const chunks = new Map<string, Uint8Array>();
  const preserved = [];
  const maxChunks = options.limits?.maxChunks ?? DEFAULT_LIMITS.maxChunks;
  let chunkCount = 0;
  while (reader.offset + 8 <= Math.min(data.length, formSize + 8)) {
    if (++chunkCount > maxChunks) throw new RetroImageError("LIMIT_EXCEEDED", "IFF chunk count exceeds the configured limit");
    const id = reader.ascii(4);
    const size = reader.u32be();
    const chunk = reader.bytes(size);
    if (size & 1) reader.skip(1);
    if (["BMHD", "CMAP", "CAMG", "BODY"].includes(id)) chunks.set(id, chunk);
    else preserved.push({ id, data: chunk });
  }
  const bmhd = chunks.get("BMHD");
  const bodyChunk = chunks.get("BODY");
  if (!bmhd || !bodyChunk) throw new RetroImageError("INVALID_FILE", "ILBM requires BMHD and BODY chunks");
  const header = parseHeader(bmhd);
  if (header.width <= 0 || header.height <= 0 || header.planes < 1 || header.planes > 8) throw new RetroImageError("INVALID_FILE", "Unsupported ILBM dimensions or plane count");
  const rowBytes = ((header.width + 15) >>> 4) << 1;
  const expected = rowBytes * (header.planes + (header.masking === 1 ? 1 : 0)) * header.height;
  const body = header.compression === 0 ? bodyChunk : header.compression === 1
    ? decodeByteRun1(bodyChunk, expected, options.limits?.maxDecompressedBytes ?? DEFAULT_LIMITS.maxDecompressedBytes, rowBytes)
    : (() => { throw new RetroImageError("UNSUPPORTED_MODE", `Unsupported ILBM compression ${header.compression}`); })();
  const cmap = chunks.get("CMAP") ?? new Uint8Array();
  const palette: RgbColor[] = [];
  for (let offset = 0; offset + 2 < cmap.length; offset += 3) palette.push({ r: cmap[offset]!, g: cmap[offset + 1]!, b: cmap[offset + 2]! });
  const camgBytes = chunks.get("CAMG");
  const camg = camgBytes && camgBytes.length >= 4 ? new DataView(camgBytes.buffer, camgBytes.byteOffset, 4).getUint32(0) : 0;
  const modeId = identifyMode(header.planes, camg, cmap, options.displayProfile?.hardware);
  const mode = amigaModes.find(({ id }) => id === modeId)!;
  const range = mode.dimensionRange;
  if (range && (header.width < range.minWidth || header.width > range.maxWidth || header.height < range.minHeight || header.height > range.maxHeight)) {
    throw new RetroImageError("INVALID_FILE", `${header.width}x${header.height} exceeds ${mode.label} safety limits`);
  }
  const unpacked = planarIndices(body, header.width, header.height, header.planes, header.masking);
  const finalPalette = modeId === "ocs-ehb" ? halfbritePalette(palette) : palette;
  const preview = applyMask(modeId === "ocs-ham6" ? renderHam(unpacked.indices, header.width, header.height, finalPalette, 6)
    : modeId === "aga-ham8" ? renderHam(unpacked.indices, header.width, header.height, finalPalette, 8)
      : indexedToRgba(unpacked.indices, header.width, header.height, finalPalette), unpacked.mask);
  const timing = inferDisplayVariant(header, camg, mode);
  const inferredHardware = modeId.startsWith("aga") ? "aga" : modeId.startsWith("ecs-") ? "ecs" : "ocs";
  const profile = {
    ...(options.displayProfile ?? { hardware: inferredHardware }),
    videoStandard: options.displayProfile?.videoStandard ?? timing?.videoStandard ?? "pal" as const,
    interlaced: Boolean(camg & LACE)
  };
  const warnings = [];
  const ambiguousHardware = options.displayProfile?.hardware === undefined && header.planes <= 6 && ![...cmap].some((value) => value % 17 !== 0);
  if (ambiguousHardware || (!options.displayProfile?.videoStandard && !timing)) warnings.push({ code: "ASSUMED_DISPLAY_PROFILE", message: `Inferred ${profile.hardware} and defaulted ambiguous display fields to ${profile.videoStandard.toUpperCase()}` });
  const unsupportedRaster = preserved.filter(({ id }) => ["PCHG", "CTBL", "SHAM"].includes(id));
  if (unsupportedRaster.length) warnings.push({ code: "UNRENDERED_RASTER_EFFECT", message: "Raster palette chunks were preserved but not rendered", details: unsupportedRaster.map(({ id }) => id) });
  if (preserved.some(({ id }) => ["CRNG", "CCRT", "DRNG"].includes(id))) warnings.push({ code: "UNPLAYED_COLOR_CYCLING", message: "Color cycling metadata was preserved but not animated" });
  return {
    kind: "raster", formatId: ilbmDefinition.id, modeId, width: header.width, height: header.height,
    pixelAspect: pixelAspect(header, camg), displayProfile: profile, palette: finalPalette, preview,
    indices: unpacked.indices,
    components: { body, palette: cmap.slice(), ...(unpacked.mask ? { mask: unpacked.mask } : {}) },
    metadata: { camg, planes: header.planes, masking: header.masking, compression: header.compression, transparentColor: header.transparentColor, pageWidth: header.pageWidth, pageHeight: header.pageHeight, planarLayout: "row-interleaved" },
    warnings, preserved
  };
}

function iffChunk(id: string, data: Uint8Array): Uint8Array {
  const writer = new BinaryWriter();
  writer.ascii(id); writer.u32be(data.length); writer.bytes(data); if (data.length & 1) writer.u8(0);
  return writer.result();
}

function modePlanes(document: RasterDocument): number {
  const mode = amigaModes.find(({ id }) => id === document.modeId);
  if (!mode) throw new RetroImageError("UNSUPPORTED_MODE", document.modeId);
  if (document.modeId === "aga-ham8") return 8;
  if (document.modeId === "ocs-ham6" || document.modeId === "ocs-ehb") return 6;
  const highestIndex = document.indices.reduce((maximum, value) => Math.max(maximum, value), 0);
  const required = Math.max(1, Math.ceil(Math.log2(Math.max(2, document.palette.length, highestIndex + 1))));
  const metadata = document.metadata.planes;
  return typeof metadata === "number" && Number.isInteger(metadata) && metadata >= required && metadata <= mode.bitsPerPixel
    ? metadata
    : required;
}

function selectedVariant(mode: FormatModeDefinition, profile: RasterDocument["displayProfile"]) {
  const variant = mode.displayVariants?.find(({ videoStandard, interlaced }) => videoStandard === (profile.videoStandard ?? "pal") && interlaced === (profile.interlaced ?? false));
  if (!variant) throw new RetroImageError("UNSUPPORTED_MODE", `Missing display variant for ${mode.id}`);
  return variant;
}

function encodeIlbm(document: RetroImageDocument, options: EncodeOptions): Uint8Array {
  if (document.kind !== "raster") throw new RetroImageError("VALIDATION_FAILED", "ILBM encodes raster documents only");
  assertEncodable(document, ilbmDefinition.id);
  const mode = amigaModes.find(({ id }) => id === document.modeId);
  if (!mode) throw new RetroImageError("UNSUPPORTED_MODE", document.modeId);
  const variant = selectedVariant(mode, document.displayProfile);
  const planes = modePlanes(document);
  const candidateMask = document.components.mask ?? imageMask(document.preview);
  const mask = candidateMask?.some((value) => value === 0) ? candidateMask : undefined;
  const rawBody = packPlanar(document.indices, document.width, document.height, planes, mask);
  const compression = options.compression === "byterun1" ? 1 : 0;
  const rowBytes = ((document.width + 15) >>> 4) << 1;
  const body = compression ? encodeByteRun1Rows(rawBody, rowBytes) : rawBody;
  const bmhd = new BinaryWriter();
  bmhd.u16be(document.width); bmhd.u16be(document.height); bmhd.u16be(0); bmhd.u16be(0);
  bmhd.u8(planes); bmhd.u8(mask ? 1 : 0); bmhd.u8(compression); bmhd.u8(0);
  bmhd.u16be(typeof document.metadata.transparentColor === "number" ? document.metadata.transparentColor : 0);
  bmhd.u8(variant.pixelAspect.numerator); bmhd.u8(variant.pixelAspect.denominator);
  bmhd.u16be(variant.nominalPageSize.width); bmhd.u16be(variant.nominalPageSize.height);
  const cmap = paletteBytes(document.modeId === "ocs-ehb" ? document.palette.slice(0, 32) : document.palette);
  let camg = (typeof document.metadata.camg === "number" ? document.metadata.camg : 0) & ~(HIRES | SUPERHIRES | LACE | HAM | HALFBRITE);
  if (mode.resolutionClass === "high") camg |= HIRES;
  if (mode.resolutionClass === "super-high") camg |= SUPERHIRES;
  if (document.displayProfile.interlaced) camg |= LACE;
  if (document.modeId.includes("ham")) camg |= HAM;
  if (document.modeId === "ocs-ehb") camg |= HALFBRITE;
  const camgData = new Uint8Array(4);
  new DataView(camgData.buffer).setUint32(0, camg);
  const chunks = [iffChunk("BMHD", bmhd.result()), iffChunk("CMAP", cmap), iffChunk("CAMG", camgData)];
  if (options.preserveUnknown !== false) for (const section of document.preserved) chunks.push(iffChunk(section.id, section.data));
  chunks.push(iffChunk("BODY", body));
  const formSize = 4 + chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const writer = new BinaryWriter();
  writer.ascii("FORM"); writer.u32be(formSize); writer.ascii("ILBM"); for (const chunk of chunks) writer.bytes(chunk);
  return writer.result();
}

function rawDecode(data: Uint8Array, options: DecodeOptions): RasterDocument {
  const { width, height, modeId } = options;
  const componentPalette = options.components?.palette;
  const hintedPalette = options.palette ?? (componentPalette ? Array.from({ length: Math.floor(componentPalette.length / 3) }, (_, index) => ({ r: componentPalette[index * 3]!, g: componentPalette[index * 3 + 1]!, b: componentPalette[index * 3 + 2]! })) : undefined);
  if (!width || !height || !modeId || !hintedPalette) throw new RetroImageError("MISSING_HINT", "Raw Amiga planar decode requires width, height, modeId, and palette");
  const mode = amigaModes.find(({ id }) => id === modeId);
  if (!mode) throw new RetroImageError("UNSUPPORTED_MODE", `Unknown Amiga mode ${modeId}`);
  const planes = options.amigaPlanar?.planes ?? (modeId === "aga-ham8" ? 8 : modeId === "ocs-ham6" || modeId === "ocs-ehb" ? 6 : Math.max(1, Math.ceil(Math.log2(Math.max(2, hintedPalette.length)))));
  const masking = options.amigaPlanar?.mask ? 1 : 0;
  const layout = options.amigaPlanar?.layout ?? "row-interleaved";
  const unpacked = planarIndices(data, width, height, planes, masking, layout);
  const palette = modeId === "ocs-ehb" ? halfbritePalette(hintedPalette) : hintedPalette;
  const preview = applyMask(modeId === "ocs-ham6" ? renderHam(unpacked.indices, width, height, palette, 6)
    : modeId === "aga-ham8" ? renderHam(unpacked.indices, width, height, palette, 8)
      : indexedToRgba(unpacked.indices, width, height, palette), unpacked.mask);
  return {
    ...rasterDocument({ formatId: rawDefinition.id, modeId, width, height, pixelAspect: selectedVariant(mode, options.displayProfile ?? { hardware: mode.hardwareProfiles[0]!, videoStandard: "pal", interlaced: false }).pixelAspect, displayProfile: options.displayProfile ?? { hardware: mode.hardwareProfiles[0]!, videoStandard: "pal", interlaced: false }, palette, indices: unpacked.indices, components: { body: data.slice(), palette: paletteBytes(hintedPalette), ...(unpacked.mask ? { mask: unpacked.mask } : {}) }, metadata: { planes, masking, planarLayout: layout }, warnings: options.displayProfile ? [] : [{ code: "ASSUMED_DISPLAY_PROFILE", message: "Assumed PAL for raw Amiga data" }], preserved: [] }),
    preview
  };
}

function amigaIssues(image: RgbaImage | RetroImageDocument, target: CodecTarget, mode: FormatModeDefinition): AnalysisIssue[] {
  const issues: AnalysisIssue[] = [];
  const preview = imagePreview(image);
  if ([...Array(preview.width * preview.height).keys()].some((pixel) => ![0, 255].includes(preview.data[pixel * 4 + 3]!))) {
    issues.push({ severity: "error", code: "NON_BINARY_ALPHA", message: "Amiga transparency is one bit; alpha must be 0 or 255", rule: "transparency.oneBit" });
  }
  if (!("kind" in image) || image.kind !== "raster") return issues;

  const ehb = target.modeId === "ocs-ehb";
  const storedCapacity = mode.palette?.storableColorEntries ?? mode.maxColors;
  const paletteLengthValid = ehb
    ? image.palette.length <= storedCapacity || image.palette.length === mode.palette?.displayColorLimit
    : image.palette.length <= storedCapacity;
  if (!paletteLengthValid) {
    issues.push({ severity: "error", code: "PALETTE_CAPACITY_EXCEEDED", message: `${image.palette.length} palette entries exceed ${mode.label} native storage`, rule: "palette.storableColorEntries", details: { actual: image.palette.length, maximum: storedCapacity } });
  }
  if (ehb && image.palette.length > storedCapacity && image.palette.length !== mode.palette?.displayColorLimit) {
    issues.push({ severity: "error", code: "EHB_DERIVED_PALETTE_MISMATCH", message: "EHB palettes must contain at most 32 bases or exactly 64 base-plus-derived entries", rule: "palette.derivedHalfBrite" });
  }

  const baseCount = ehb ? Math.min(storedCapacity, image.palette.length) : image.palette.length;
  const storedPalette = image.palette.slice(0, baseCount);
  const declaredPrecision = mode.palette?.componentPrecision?.[0];
  const precision = resolveRgbComponentPrecision(mode, target.displayProfile) ?? (declaredPrecision ? {
    redBits: declaredPrecision.redBits,
    greenBits: declaredPrecision.greenBits,
    blueBits: declaredPrecision.blueBits
  } : undefined);
  if (precision && storedPalette.some((color) => !isRgbOnComponentGrid(color, precision))) {
    issues.push({ severity: "error", code: "STORED_COLOR_OUTSIDE_COMPONENT_GRID", message: "A stored palette entry is outside the target component grid", rule: "palette.rgbComponentPrecision" });
  }

  if (ehb && image.palette.length === 64) {
      const derived = halfbritePalette(storedPalette).slice(32);
      if (derived.some((color, index) => {
        const actual = image.palette[index + 32];
        return !actual || color.r !== actual.r || color.g !== actual.g || color.b !== actual.b;
      })) issues.push({ severity: "error", code: "EHB_DERIVED_PALETTE_MISMATCH", message: "EHB derived colors must be half intensity of their bases", rule: "palette.derivedHalfBrite" });
  }

  const displayCapacity = Math.min(1 << Math.min(8, mode.bitsPerPixel), mode.palette?.displayColorLimit ?? mode.maxColors);
  const outOfCapacity = image.indices.findIndex((index) => index >= displayCapacity);
  if (outOfCapacity >= 0) issues.push({ severity: "error", code: "INDEX_OUTSIDE_MODE_CAPACITY", message: `Index ${image.indices[outOfCapacity]} exceeds ${mode.label} display capacity`, rule: "indices.displayCapacity", details: { pixel: outOfCapacity, index: image.indices[outOfCapacity]!, maximum: displayCapacity - 1 } });

  if (mode.colorModel === "indexed") {
    const missing = image.indices.findIndex((index) => ehb
      ? (index < 32 ? index >= baseCount : index - 32 >= baseCount)
      : index >= image.palette.length);
    if (missing >= 0) issues.push({ severity: "error", code: "INDEX_WITHOUT_STORED_COLOR", message: `Index ${image.indices[missing]} has no stored palette source`, rule: "indices.storedPalette", details: { pixel: missing, index: image.indices[missing]! } });
  }

  const expectedMinimum = mode.colorModel === "ham" || ehb
    ? mode.bitsPerPixel
    : Math.max(1, Math.ceil(Math.log2(Math.max(2, image.palette.length, (image.indices.reduce((maximum, value) => Math.max(maximum, value), 0)) + 1))));
  const planes = image.metadata.planes;
  if (planes !== undefined && (typeof planes !== "number" || !Number.isInteger(planes) || planes < expectedMinimum || planes > mode.bitsPerPixel || ((mode.colorModel === "ham" || ehb) && planes !== mode.bitsPerPixel))) {
    issues.push({ severity: "error", code: "PLANE_COUNT_MISMATCH", message: `Plane count ${JSON.stringify(planes)} is incompatible with ${mode.label}`, rule: "bitplanes.modeCompatibility", details: { minimum: expectedMinimum, maximum: mode.bitsPerPixel } });
  }
  return issues;
}

function withoutPalette(mode: FormatModeDefinition): FormatModeDefinition {
  const result = { ...mode };
  delete result.palette;
  return result;
}

function analyzeAmiga(image: RgbaImage | RetroImageDocument, target: CodecTarget, mode: FormatModeDefinition): AnalysisResult {
  const base = analyzeDimensions(image, target, target.modeId === "ocs-ehb" ? withoutPalette(mode) : mode);
  const issues = [...base.issues, ...amigaIssues(image, target, mode)];
  return { valid: !issues.some(({ severity }) => severity === "error"), target, issues };
}

function assertEncodable(document: RasterDocument, formatId: string): void {
  const mode = amigaModes.find(({ id }) => id === document.modeId);
  if (!mode) throw new RetroImageError("UNSUPPORTED_MODE", document.modeId);
  const analysis = analyzeAmiga(document, { formatId, modeId: document.modeId, displayProfile: document.displayProfile }, mode);
  if (!analysis.valid) throw new RetroImageError("VALIDATION_FAILED", "Document violates Amiga target limitations", analysis);
}

async function convertEhb(image: RgbaImage | RetroImageDocument, target: Parameters<NonNullable<FormatPlugin["convert"]>>[1], options: Parameters<NonNullable<FormatPlugin["convert"]>>[2]) {
  const mode = amigaModes.find(({ id }) => id === "ocs-ehb")!;
  const prepared = prepareConversionImage(image, mode, options);
  const colors = new Map<string, { color: RgbColor; count: number }>();
  for (let pixel = 0; pixel < prepared.image.width * prepared.image.height; pixel += 1) {
    if (prepared.image.data[pixel * 4 + 3]! < 128) continue;
    const offset = pixel * 4;
    const color = quantizeRgbToComponentGrid({ r: prepared.image.data[offset]!, g: prepared.image.data[offset + 1]!, b: prepared.image.data[offset + 2]! }, { redBits: 4, greenBits: 4, blueBits: 4 });
    const key = `${color.r},${color.g},${color.b}`;
    const entry = colors.get(key);
    if (entry) entry.count += 1; else colors.set(key, { color, count: 1 });
  }
  const frequencies = [...colors.values()];
  const ranked = frequencies.map(({ color }) => {
    const half = { r: color.r >>> 1, g: color.g >>> 1, b: color.b >>> 1 };
    const error = frequencies.reduce((sum, source) => sum + source.count * Math.min(colorDistance(source.color, color), colorDistance(source.color, half)), 0);
    return { color, error };
  }).sort((a, b) => a.error - b.error || a.color.r - b.color.r || a.color.g - b.color.g || a.color.b - b.color.b);
  const base = ranked.slice(0, 32).map(({ color }) => color);
  if (!base.length) base.push({ r: 0, g: 0, b: 0 });
  const palette = halfbritePalette(base);
  const indices = mapToPalette(prepared.image, palette, "none");
  const mask = imageMask(prepared.image);
  const profile = { ...target.displayProfile, interlaced: target.displayProfile.interlaced ?? false };
  const preview = applyMask(indexedToRgba(indices, prepared.image.width, prepared.image.height, palette), mask);
  const document: RasterDocument = { kind: "raster", formatId: target.formatId, modeId: target.modeId, width: prepared.image.width, height: prepared.image.height, pixelAspect: selectedVariant(mode, profile).pixelAspect, displayProfile: profile, palette, preview, indices, components: { palette: paletteBytes(base), ...(mask ? { mask } : {}) }, metadata: { planes: 6, camg: HALFBRITE, planarLayout: "row-interleaved" }, warnings: [], preserved: [] };
  return { document, report: { target, steps: [...prepared.steps, { operation: "ehb-palette", message: `Selected ${base.length} EHB bases and derived half-bright colors without dithering` }], warnings: [] } };
}

/** Amiga IFF ILBM codec. */
export const amigaIlbmPlugin: FormatPlugin = {
  definition: ilbmDefinition,
  probe(data, context) {
    const magic = data.length >= 12 && String.fromCharCode(...data.subarray(0, 4)) === "FORM" && String.fromCharCode(...data.subarray(8, 12)) === "ILBM";
    if (!magic) return null;
    const extension = extensionOf(context.filename);
    return { formatId: ilbmDefinition.id, confidence: ["iff", "ilbm", "lbm"].includes(extension) ? 1 : 0.95, reason: "IFF FORM ILBM signature" };
  },
  async decode(data, options) { return decodeIlbm(data, options); },
  async encode(document, options): Promise<EncodeResult> { return { data: encodeIlbm(document, options), formatId: ilbmDefinition.id, warnings: [] }; },
  analyze(image, target) {
    const mode = amigaModes.find(({ id }) => id === target.modeId)!;
    return analyzeAmiga(image, target, mode);
  },
  async convert(image, target, options) {
    const mode = amigaModes.find(({ id }) => id === target.modeId);
    if (!mode) throw new RetroImageError("UNSUPPORTED_MODE", target.modeId);
    if (target.modeId === "ocs-ehb") return convertEhb(image, target, options);
    const converted = await genericConvert(image, target, mode, options);
    if (converted.document.kind !== "raster") throw new RetroImageError("VALIDATION_FAILED", "Expected raster conversion");
    const document = converted.document;
    const sourceImage = imagePreview(image);
    const mask = sourceImage.width === document.width && sourceImage.height === document.height ? imageMask(sourceImage) : undefined;
    document.displayProfile = { ...target.displayProfile, interlaced: target.displayProfile.interlaced ?? false };
    document.pixelAspect = selectedVariant(mode, document.displayProfile).pixelAspect;
    if (target.modeId === "ocs-ham6" || target.modeId === "aga-ham8") {
      const bits = target.modeId === "ocs-ham6" ? 6 : 8;
      const source = sourceImage;
      const prepared = source.width === document.width && source.height === document.height ? source : document.preview;
      document.indices = hamCommands(prepared, document.palette, bits);
      document.preview = renderHam(document.indices, document.width, document.height, document.palette, bits);
      document.metadata.camg = HAM;
      document.metadata.planes = bits;
      converted.report.steps.push({ operation: "ham", message: `Applied deterministic HAM${bits} scanline optimization` });
    } else {
      document.metadata.planes = Math.max(1, Math.ceil(Math.log2(Math.max(2, document.palette.length))));
    }
    document.preview = applyMask(document.preview, mask);
    document.components = { palette: paletteBytes(document.palette), ...(mask ? { mask } : {}) };
    document.metadata.planarLayout = "row-interleaved";
    return converted;
  }
};

/** Headerless Amiga planar bitmap codec requiring explicit hints. */
export const amigaRawPlanarPlugin: FormatPlugin = {
  definition: rawDefinition,
  probe() { return null; },
  async decode(data, options) { return rawDecode(data, options); },
  async encode(document, options): Promise<EncodeResult> {
    if (document.kind !== "raster") throw new RetroImageError("VALIDATION_FAILED", "Raw planar output requires a raster document");
    assertEncodable(document, rawDefinition.id);
    const candidateMask = document.components.mask ?? imageMask(document.preview);
    const mask = candidateMask?.some((value) => value === 0) ? candidateMask : undefined;
    return { data: packPlanar(document.indices, document.width, document.height, modePlanes(document), mask, options.amigaPlanar?.layout ?? "row-interleaved"), formatId: rawDefinition.id, warnings: [] };
  },
  analyze(image, target) {
    const mode = amigaModes.find(({ id }) => id === target.modeId)!;
    return analyzeAmiga(image, target, mode);
  },
  async convert(image, target, options) {
    if (target.modeId === "ocs-ehb") return convertEhb(image, target, options);
    return amigaIlbmPlugin.convert!(image, target, options);
  }
};

/** All built-in Amiga codecs. */
export const amigaPlugins: FormatPlugin[] = [amigaIlbmPlugin, amigaRawPlanarPlugin];

/** Convert one 12-bit Amiga hardware color word to RGB. */
export { rgb12 as amigaRgb12 };
