import { BinaryReader, BinaryWriter, DEFAULT_LIMITS, extensionOf } from "../core/binary";
import { genericConvert } from "../core/conversion";
import { RetroImageError } from "../core/errors";
import type { CodecWarning, DecodeOptions, EncodeOptions, EncodeResult, FormatDefinition, FormatModeDefinition, FormatPlugin, PreservedSection, RasterDocument, RetroImageDocument, RgbColor } from "../core/types";
import { modeAnalysis, rasterDocument } from "./common";

const stModes: FormatModeDefinition[] = [
  {
    id: "st-low", label: "ST Low 320x200x16", dimensions: [{ width: 320, height: 200 }], pixelAspect: { numerator: 1, denominator: 1 }, colorModel: "indexed", bitsPerPixel: 4, maxColors: 16, paletteBitsPerChannel: 3, hardwareProfiles: ["st", "ste"], videoStandards: ["pal", "ntsc"], supportsTransparency: false,
    palette: { model: "programmable-indexed", displayColorLimit: 16, storableColorEntries: 16, componentPrecision: [{ hardwareProfiles: ["st"], redBits: 3, greenBits: 3, blueBits: 3 }, { hardwareProfiles: ["ste"], redBits: 4, greenBits: 4, blueBits: 4 }] },
    resolutionClass: "low", interlaceSupport: "none",
    displayVariants: ["pal", "ntsc"].map((videoStandard) => ({ id: videoStandard, label: videoStandard.toUpperCase(), hardwareProfiles: ["st", "ste"], videoStandard: videoStandard as "pal" | "ntsc", nominalPageSize: { width: 320, height: 200 }, pixelAspect: { numerator: 1, denominator: 1 }, interlaced: false }))
  },
  {
    id: "st-medium", label: "ST Medium 640x200x4", dimensions: [{ width: 640, height: 200 }], pixelAspect: { numerator: 1, denominator: 2 }, colorModel: "indexed", bitsPerPixel: 2, maxColors: 4, paletteBitsPerChannel: 3, hardwareProfiles: ["st", "ste"], videoStandards: ["pal", "ntsc"], supportsTransparency: false,
    palette: { model: "programmable-indexed", displayColorLimit: 4, storableColorEntries: 16, componentPrecision: [{ hardwareProfiles: ["st"], redBits: 3, greenBits: 3, blueBits: 3 }, { hardwareProfiles: ["ste"], redBits: 4, greenBits: 4, blueBits: 4 }] },
    resolutionClass: "medium", interlaceSupport: "none",
    displayVariants: ["pal", "ntsc"].map((videoStandard) => ({ id: videoStandard, label: videoStandard.toUpperCase(), hardwareProfiles: ["st", "ste"], videoStandard: videoStandard as "pal" | "ntsc", nominalPageSize: { width: 640, height: 200 }, pixelAspect: { numerator: 1, denominator: 2 }, interlaced: false }))
  },
  {
    id: "st-high", label: "ST High 640x400x2", dimensions: [{ width: 640, height: 400 }], pixelAspect: { numerator: 1, denominator: 1 }, colorModel: "indexed", bitsPerPixel: 1, maxColors: 2, paletteBitsPerChannel: 3, hardwareProfiles: ["st", "ste"], videoStandards: ["pal"], supportsTransparency: false,
    palette: { model: "monochrome", displayColorLimit: 2, storableColorEntries: 16, fixedColors: [{ r: 255, g: 255, b: 255 }, { r: 0, g: 0, b: 0 }], supportsInverse: true },
    resolutionClass: "high", interlaceSupport: "none",
    displayVariants: [{ id: "pal", label: "PAL monochrome", hardwareProfiles: ["st", "ste"], videoStandard: "pal", nominalPageSize: { width: 640, height: 400 }, pixelAspect: { numerator: 1, denominator: 1 }, interlaced: false }]
  }
];

function def(id: string, label: string, extensions: string[], modes = stModes, raw = false): FormatDefinition {
  return { schemaVersion: 1, id, label, platform: "Atari ST/STE", extensions, mimeTypes: ["application/x-atari-st-image"], canDecode: true, canEncode: true, raw, modes };
}
const degasDefinition = def("atari-st.degas", "Atari DEGAS", ["pi1", "pi2", "pi3"]);
const compressedDefinition = def("atari-st.degas-compressed", "Atari DEGAS compressed", ["pc1", "pc2", "pc3"]);
degasDefinition.encodingVariants = [{ id: "uncompressed", label: "Uncompressed PI", encodeOptions: { compression: "none" } }];
compressedDefinition.encodingVariants = [{ id: "packbits", label: "DEGAS PackBits PC", encodeOptions: { compression: "packbits" } }];
const neoDefinition = def("atari-st.neochrome", "Atari NEOchrome", ["neo"], [stModes[0]!]);
const rawDefinition = def("atari-st.raw-planar", "Atari ST raw planar screen", ["raw", "bin"], stModes, true);

interface DegasResolution {
  compressed: boolean;
  index: number;
  mode: FormatModeDefinition;
}

function parseResolution(value: number): DegasResolution {
  const compressed = (value & 0x8000) !== 0;
  const index = value & 0x7fff;
  const mode = stModes[index];
  if (!mode) throw new RetroImageError("INVALID_FILE", `Unsupported DEGAS resolution word 0x${value.toString(16).padStart(4, "0")}`);
  return { compressed, index, mode };
}

function modeById(modeId: string): FormatModeDefinition {
  const mode = stModes.find(({ id }) => id === modeId);
  if (!mode) throw new RetroImageError("UNSUPPORTED_MODE", modeId);
  return mode;
}

function paletteColor(word: number, ste: boolean): RgbColor {
  const expand = (main: number, extra: number) => ste ? Math.round((((main & 7) << 1) | extra) * 255 / 15) : Math.round((main & 7) * 255 / 7);
  return { r: expand(word >>> 8, (word >>> 11) & 1), g: expand(word >>> 4, (word >>> 7) & 1), b: expand(word, (word >>> 3) & 1) };
}

function paletteWord(color: RgbColor, ste: boolean): number {
  if (ste) {
    const r = Math.round(color.r * 15 / 255), g = Math.round(color.g * 15 / 255), b = Math.round(color.b * 15 / 255);
    return ((r & 1) << 11) | ((r >>> 1) << 8) | ((g & 1) << 7) | ((g >>> 1) << 4) | ((b & 1) << 3) | (b >>> 1);
  }
  return (Math.round(color.r * 7 / 255) << 8) | (Math.round(color.g * 7 / 255) << 4) | Math.round(color.b * 7 / 255);
}

function decodePlanar(data: Uint8Array, mode: FormatModeDefinition): Uint8Array {
  const { width, height } = mode.dimensions[0]!;
  const planes = mode.bitsPerPixel;
  const expected = width * height * planes / 8;
  if (data.length < expected) throw new RetroImageError("INVALID_FILE", `Atari ST screen requires ${expected} bytes`);
  const indices = new Uint8Array(width * height);
  let offset = 0;
  for (let y = 0; y < height; y += 1) {
    for (let group = 0; group < width / 16; group += 1) {
      const words: number[] = [];
      for (let plane = 0; plane < planes; plane += 1) {
        words.push((data[offset]! << 8) | data[offset + 1]!);
        offset += 2;
      }
      for (let x = 0; x < 16; x += 1) {
        let value = 0;
        for (let plane = 0; plane < planes; plane += 1) if (words[plane]! & (0x8000 >>> x)) value |= 1 << plane;
        indices[y * width + group * 16 + x] = value;
      }
    }
  }
  return indices;
}

function encodePlanar(document: RetroImageDocument, mode: FormatModeDefinition): Uint8Array {
  if (document.kind !== "raster") throw new RetroImageError("VALIDATION_FAILED", "Atari ST output requires a raster document");
  const { width, height } = mode.dimensions[0]!;
  if (document.width !== width || document.height !== height) throw new RetroImageError("VALIDATION_FAILED", `Mode ${mode.id} requires ${width}x${height}`);
  const output = new Uint8Array(32000);
  let offset = 0;
  for (let y = 0; y < height; y += 1) for (let group = 0; group < width / 16; group += 1) {
    for (let plane = 0; plane < mode.bitsPerPixel; plane += 1) {
      let word = 0;
      for (let x = 0; x < 16; x += 1) if (document.indices[y * width + group * 16 + x]! & (1 << plane)) word |= 0x8000 >>> x;
      output[offset++] = word >>> 8; output[offset++] = word & 0xff;
    }
  }
  return output;
}

function degasPcToInterleaved(data: Uint8Array, mode: FormatModeDefinition): Uint8Array {
  const { width, height } = mode.dimensions[0]!;
  const planes = mode.bitsPerPixel;
  const planeRowBytes = width / 8;
  const rowBytes = planeRowBytes * planes;
  const output = new Uint8Array(32000);
  for (let y = 0; y < height; y += 1) {
    const rowOffset = y * rowBytes;
    for (let group = 0; group < width / 16; group += 1) {
      for (let plane = 0; plane < planes; plane += 1) {
        const source = rowOffset + plane * planeRowBytes + group * 2;
        const target = rowOffset + (group * planes + plane) * 2;
        output[target] = data[source]!;
        output[target + 1] = data[source + 1]!;
      }
    }
  }
  return output;
}

function interleavedToDegasPc(data: Uint8Array, mode: FormatModeDefinition): Uint8Array {
  const { width, height } = mode.dimensions[0]!;
  const planes = mode.bitsPerPixel;
  const planeRowBytes = width / 8;
  const rowBytes = planeRowBytes * planes;
  const output = new Uint8Array(32000);
  for (let y = 0; y < height; y += 1) {
    const rowOffset = y * rowBytes;
    for (let group = 0; group < width / 16; group += 1) {
      for (let plane = 0; plane < planes; plane += 1) {
        const source = rowOffset + (group * planes + plane) * 2;
        const target = rowOffset + plane * planeRowBytes + group * 2;
        output[target] = data[source]!;
        output[target + 1] = data[source + 1]!;
      }
    }
  }
  return output;
}

function unpackPackBits(data: Uint8Array, maxBytes: number): { screen: Uint8Array; consumed: number } {
  const outputSize = 32000;
  if (outputSize > maxBytes) throw new RetroImageError("LIMIT_EXCEEDED", "DEGAS output exceeds configured limit");
  const output = new Uint8Array(outputSize);
  const reader = new BinaryReader(data);
  let offset = 0;
  while (reader.remaining > 0 && offset < output.length) {
    const control = reader.i8();
    if (control >= 0) {
      const bytes = reader.bytes(control + 1);
      if (offset + bytes.length > output.length) throw new RetroImageError("INVALID_FILE", "DEGAS literal run exceeds screen size");
      output.set(bytes, offset); offset += bytes.length;
    } else if (control !== -128) {
      const count = 1 - control;
      if (offset + count > output.length) throw new RetroImageError("INVALID_FILE", "DEGAS repeat run exceeds screen size");
      output.fill(reader.u8(), offset, offset + count); offset += count;
    }
  }
  if (offset !== output.length) throw new RetroImageError("INVALID_FILE", "Compressed DEGAS data is incomplete");
  return { screen: output, consumed: reader.offset };
}

function packBits(data: Uint8Array): Uint8Array {
  const output: number[] = [];
  let offset = 0;
  while (offset < data.length) {
    let run = 1;
    while (offset + run < data.length && run < 128 && data[offset + run] === data[offset]) run += 1;
    if (run >= 3) { output.push(257 - run, data[offset]!); offset += run; continue; }
    const start = offset; offset += run;
    while (offset < data.length && offset - start < 128) {
      run = 1; while (offset + run < data.length && run < 3 && data[offset + run] === data[offset]) run += 1;
      if (run >= 3) break; offset += run;
    }
    output.push(offset - start - 1, ...data.subarray(start, offset));
  }
  return Uint8Array.from(output);
}

function packDegasPc(data: Uint8Array): Uint8Array {
  const output = new BinaryWriter();
  for (let offset = 0; offset < data.length; offset += 40) {
    output.bytes(packBits(data.subarray(offset, offset + 40)));
  }
  return output.result();
}

function filenameWarning(filename: string | undefined, actualIndex: number, actualCompressed: boolean): CodecWarning | undefined {
  const extension = extensionOf(filename);
  const match = /^(pi|pc)([123])$/.exec(extension);
  if (!match) return undefined;
  const expectedCompressed = match[1] === "pc";
  const expectedIndex = Number(match[2]) - 1;
  if (expectedIndex === actualIndex && expectedCompressed === actualCompressed) return undefined;
  const expectedMode = stModes[expectedIndex]!;
  const actualMode = stModes[actualIndex]!;
  const expectedFamily = expectedCompressed ? "compressed PC" : "uncompressed PI";
  const actualFamily = actualCompressed ? "compressed PC" : "uncompressed PI";
  return {
    code: "FILENAME_EXTENSION_MISMATCH",
    message: `Filename extension .${extension.toUpperCase()} indicates ${expectedMode.label} ${expectedFamily}, but the file contains ${actualMode.label} ${actualFamily} data.`,
    details: {
      extension,
      expectedModeId: expectedMode.id,
      actualModeId: actualMode.id,
      expectedCompressed,
      actualCompressed
    }
  };
}

function isEliteFooter(data: Uint8Array): boolean {
  if (data.length !== 32) return false;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  for (let index = 0; index < 8; index += 1) if (view.getUint16(index * 2) > 15) return false;
  for (let index = 8; index < 12; index += 1) if (view.getUint16(index * 2) > 2) return false;
  for (let index = 12; index < 16; index += 1) if (view.getUint16(index * 2) > 128) return false;
  return true;
}

function classifyCompressedTrailer(data: Uint8Array): { footer?: Uint8Array; preserved: PreservedSection[]; warnings: CodecWarning[] } {
  if (data.length === 0) return { preserved: [], warnings: [] };
  if (data.length === 32) return { footer: data.slice(), preserved: [], warnings: [] };
  const eliteFooterSeparated = data.length > 32 && isEliteFooter(data.subarray(0, 32));
  const unknown = data.slice(eliteFooterSeparated ? 32 : 0);
  return {
    ...(eliteFooterSeparated ? { footer: data.slice(0, 32) } : {}),
    preserved: [{ id: "degas.trailing", data: unknown }],
    warnings: [{
      code: "UNKNOWN_TRAILING_DATA",
      message: `Preserved ${unknown.length} ${unknown.length === 1 ? "byte" : "bytes"} after the DEGAS image${eliteFooterSeparated ? " and Elite footer" : ""}.`,
      details: { bytes: unknown.length, eliteFooterSeparated }
    }]
  };
}

function decodedDocument(formatId: string, mode: FormatModeDefinition, screen: Uint8Array, paletteWords: number[], options: DecodeOptions, components: Record<string, Uint8Array>, metadata: Record<string, number | string>, warnings: CodecWarning[] = [], preserved: PreservedSection[] = []): RasterDocument {
  const ste = options.displayProfile?.hardware === "ste" || (mode.id !== "st-high" && paletteWords.some((word) => (word & 0x888) !== 0));
  const palette = mode.id === "st-high"
    ? [{ r: 255, g: 255, b: 255 }, { r: 0, g: 0, b: 0 }]
    : paletteWords.slice(0, mode.maxColors).map((word) => paletteColor(word, ste));
  const indices = decodePlanar(screen, mode);
  return rasterDocument({ formatId, modeId: mode.id, width: mode.dimensions[0]!.width, height: mode.dimensions[0]!.height, pixelAspect: mode.pixelAspect, displayProfile: options.displayProfile ?? { hardware: ste ? "ste" : "st", videoStandard: "pal", paletteId: ste ? "ste-hardware" : "st-hardware" }, palette, indices, components, metadata, warnings: [...warnings, ...(options.displayProfile ? [] : [{ code: "ASSUMED_DISPLAY_PROFILE", message: `Inferred ${ste ? "STE" : "ST"} palette and assumed PAL` }])], preserved });
}

function decodeDegas(data: Uint8Array, options: DecodeOptions, compressed: boolean): RasterDocument {
  const reader = new BinaryReader(data);
  const resolution = reader.u16be();
  const parsed = parseResolution(resolution);
  if (parsed.compressed !== compressed) {
    throw new RetroImageError("INVALID_FILE", `DEGAS header contains ${parsed.compressed ? "compressed PC" : "uncompressed PI"} data, not the explicitly selected ${compressed ? "PC" : "PI"} family`);
  }
  const paletteWords = Array.from({ length: 16 }, () => reader.u16be());
  const stored = reader.bytes(reader.remaining);
  let screen: Uint8Array;
  let storedScreen: Uint8Array;
  let footer: Uint8Array | undefined;
  let preserved: PreservedSection[] = [];
  const warnings: CodecWarning[] = [];
  if (compressed) {
    const unpacked = unpackPackBits(stored, options.limits?.maxDecompressedBytes ?? DEFAULT_LIMITS.maxDecompressedBytes);
    screen = degasPcToInterleaved(unpacked.screen, parsed.mode);
    storedScreen = stored.slice(0, unpacked.consumed);
    const trailer = classifyCompressedTrailer(stored.subarray(unpacked.consumed));
    footer = trailer.footer;
    preserved = trailer.preserved;
    warnings.push(...trailer.warnings);
  } else {
    if (stored.length !== 32000 && stored.length !== 32032) throw new RetroImageError("INVALID_FILE", "Uncompressed DEGAS data must contain a 32000-byte screen and optional 32-byte DEGAS Elite footer");
    screen = stored.slice(0, 32000);
    storedScreen = screen.slice();
    if (stored.length === 32032) footer = stored.slice(32000);
  }
  const components: Record<string, Uint8Array> = { screen: screen.slice(), stored: storedScreen };
  if (footer) components.colorAnimation = footer;
  const warning = filenameWarning(options.filename, parsed.index, parsed.compressed);
  if (warning) warnings.unshift(warning);
  return decodedDocument(compressed ? compressedDefinition.id : degasDefinition.id, parsed.mode, screen, paletteWords, options, components, { resolution, compressed: compressed ? 1 : 0 }, warnings, preserved);
}

function encodeDegas(document: RetroImageDocument, compressed: boolean, options: EncodeOptions = {}): EncodeResult {
  const modeIndex = stModes.findIndex(({ id }) => id === document.modeId);
  if (modeIndex < 0) throw new RetroImageError("UNSUPPORTED_MODE", document.modeId);
  const mode = stModes[modeIndex]!;
  const screen = encodePlanar(document, mode);
  const writer = new BinaryWriter();
  writer.u16be(modeIndex | (compressed ? 0x8000 : 0));
  const ste = document.displayProfile.hardware === "ste";
  for (let i = 0; i < 16; i += 1) writer.u16be(paletteWord(document.palette[i] ?? { r: 0, g: 0, b: 0 }, ste));
  writer.bytes(compressed ? packDegasPc(interleavedToDegasPc(screen, mode)) : screen);
  const footer = document.components.colorAnimation;
  if (footer) {
    if (footer.length !== 32) throw new RetroImageError("VALIDATION_FAILED", "DEGAS Elite colorAnimation must be exactly 32 bytes");
    writer.bytes(footer);
  }
  const unknown = document.preserved.filter(({ id }) => id === "degas.trailing");
  const unsupported = document.preserved.filter(({ id }) => id !== "degas.trailing");
  if (unsupported.length > 0) throw new RetroImageError("VALIDATION_FAILED", `Unsupported preserved section ${unsupported[0]!.id} for DEGAS output`);
  const unknownBytes = unknown.reduce((total, section) => total + section.data.length, 0);
  if (compressed && options.preserveUnknown === true) for (const section of unknown) writer.bytes(section.data);
  const warnings: CodecWarning[] = [];
  if (unknownBytes > 0 && (!compressed || options.preserveUnknown !== true)) {
    warnings.push({
      code: "UNKNOWN_DATA_OMITTED",
      message: `Omitted ${unknownBytes} preserved trailing ${unknownBytes === 1 ? "byte" : "bytes"} from DEGAS output.`,
      details: { bytes: unknownBytes }
    });
  }
  return { data: writer.result(), formatId: compressed ? compressedDefinition.id : degasDefinition.id, warnings };
}

function probeDegas(data: Uint8Array, compressed: boolean): DegasResolution | null {
  try {
    if (data.length < 34) return null;
    const resolution = (data[0]! << 8) | data[1]!;
    const parsed = parseResolution(resolution);
    if (parsed.compressed !== compressed) return null;
    if (!compressed) return data.length === 32034 || data.length === 32066 ? parsed : null;
    const payload = data.subarray(34);
    unpackPackBits(payload, DEFAULT_LIMITS.maxDecompressedBytes);
    return parsed;
  } catch {
    return null;
  }
}

function decodeNeo(data: Uint8Array, options: DecodeOptions): RasterDocument {
  if (data.length !== 32128) throw new RetroImageError("INVALID_FILE", "NEOchrome file must be 32128 bytes");
  const reader = new BinaryReader(data);
  const flag = reader.u16be();
  const resolution = reader.u16be();
  if ((resolution & 3) !== 0) throw new RetroImageError("UNSUPPORTED_MODE", "NEOchrome supports ST Low only");
  const paletteWords = Array.from({ length: 16 }, () => reader.u16be());
  const filename = reader.ascii(12).replace(/\0.*$/, "");
  const colorAnimation = reader.bytes(8);
  reader.offset = 128;
  const screen = reader.bytes(32000);
  return decodedDocument(neoDefinition.id, stModes[0]!, screen, paletteWords, options, { screen: screen.slice(), colorAnimation }, { flag, filename, resolution });
}

function encodeNeo(document: RetroImageDocument): Uint8Array {
  if (document.modeId !== "st-low") throw new RetroImageError("UNSUPPORTED_MODE", "NEOchrome supports ST Low only");
  const output = new Uint8Array(32128);
  const view = new DataView(output.buffer);
  const ste = document.displayProfile.hardware === "ste";
  for (let i = 0; i < 16; i += 1) view.setUint16(4 + i * 2, paletteWord(document.palette[i] ?? { r: 0, g: 0, b: 0 }, ste));
  const animation = document.components.colorAnimation;
  if (animation) output.set(animation.subarray(0, 8), 48);
  output.set(encodePlanar(document, stModes[0]!), 128);
  return output;
}

export const atariStDegasPlugin: FormatPlugin = {
  definition: degasDefinition,
  probe(data, context) {
    const parsed = probeDegas(data, false);
    if (!parsed) return null;
    const ext = extensionOf(context.filename);
    const exactExtension = ext === `pi${parsed.index + 1}`;
    return { formatId: degasDefinition.id, confidence: exactExtension ? 1 : 0.9, reason: `Valid DEGAS PI${parsed.index + 1} screen layout` };
  },
  async decode(data, options) { return decodeDegas(data, options, false); },
  async encode(document, options): Promise<EncodeResult> { return encodeDegas(document, false, options); },
  analyze(image, target) { const mode = stModes.find(({ id }) => id === target.modeId); if (!mode) throw new RetroImageError("UNSUPPORTED_MODE", target.modeId); return modeAnalysis(image, target, mode); },
  async convert(image, target, options) { const mode = modeById(target.modeId); const converted = await genericConvert(image, target, mode, options); const document = decodeDegas(encodeDegas(converted.document, false).data, { displayProfile: target.displayProfile }, false); converted.report.steps.push({ operation: "st-bitplanes", message: "Packed Atari ST interleaved bitplanes" }); return { document, report: converted.report }; }
};

export const atariStDegasCompressedPlugin: FormatPlugin = {
  definition: compressedDefinition,
  probe(data, context) {
    const parsed = probeDegas(data, true);
    if (!parsed) return null;
    const ext = extensionOf(context.filename);
    const exactExtension = ext === `pc${parsed.index + 1}`;
    return { formatId: compressedDefinition.id, confidence: exactExtension ? 1 : 0.9, reason: `Valid DEGAS PC${parsed.index + 1} PackBits screen layout` };
  },
  async decode(data, options) { return decodeDegas(data, options, true); },
  async encode(document, options): Promise<EncodeResult> { return encodeDegas(document, true, options); },
  analyze(image, target) { const mode = stModes.find(({ id }) => id === target.modeId); if (!mode) throw new RetroImageError("UNSUPPORTED_MODE", target.modeId); return modeAnalysis(image, target, mode); },
  async convert(image, target, options) { const mode = stModes.find(({ id }) => id === target.modeId); if (!mode) throw new RetroImageError("UNSUPPORTED_MODE", target.modeId); const converted = await genericConvert(image, target, mode, options); const document = decodeDegas(encodeDegas(converted.document, true).data, { displayProfile: target.displayProfile }, true); converted.report.steps.push({ operation: "st-packbits", message: "Packed Atari ST bitplanes with DEGAS PackBits" }); return { document, report: converted.report }; }
};

export const atariStNeoPlugin: FormatPlugin = {
  definition: neoDefinition,
  probe(data, context) {
    if (data.length !== 32128) return null;
    return { formatId: neoDefinition.id, confidence: extensionOf(context.filename) === "neo" ? 1 : 0.65, reason: "NEOchrome 128-byte header and screen size" };
  },
  async decode(data, options) { return decodeNeo(data, options); },
  async encode(document): Promise<EncodeResult> { return { data: encodeNeo(document), formatId: neoDefinition.id, warnings: [] }; },
  analyze(image, target) { return modeAnalysis(image, target, stModes[0]!); },
  async convert(image, target, options) { const converted = await genericConvert(image, target, stModes[0]!, options); const document = decodeNeo(encodeNeo(converted.document), { displayProfile: target.displayProfile }); converted.report.steps.push({ operation: "neochrome", message: "Packed NEOchrome low-resolution bitplanes" }); return { document, report: converted.report }; }
};

export const atariStRawPlugin: FormatPlugin = {
  definition: rawDefinition,
  probe() { return null; },
  async decode(data, options) {
    if (!options.modeId) throw new RetroImageError("MISSING_HINT", "Raw Atari ST decode requires modeId");
    const mode = stModes.find(({ id }) => id === options.modeId);
    if (!mode) throw new RetroImageError("UNSUPPORTED_MODE", options.modeId);
    if (!options.palette && mode.id !== "st-high") throw new RetroImageError("MISSING_HINT", "Raw Atari ST color modes require a palette");
    const words = (options.palette ?? []).map((color) => paletteWord(color, options.displayProfile?.hardware === "ste"));
    return decodedDocument(rawDefinition.id, mode, data, words, options, { screen: data.slice() }, { raw: 1 });
  },
  async encode(document): Promise<EncodeResult> { const mode = stModes.find(({ id }) => id === document.modeId); if (!mode) throw new RetroImageError("UNSUPPORTED_MODE", document.modeId); return { data: encodePlanar(document, mode), formatId: rawDefinition.id, warnings: [] }; },
  analyze(image, target) { const mode = stModes.find(({ id }) => id === target.modeId); if (!mode) throw new RetroImageError("UNSUPPORTED_MODE", target.modeId); return modeAnalysis(image, target, mode); },
  async convert(image, target, options) { const mode = stModes.find(({ id }) => id === target.modeId); if (!mode) throw new RetroImageError("UNSUPPORTED_MODE", target.modeId); const converted = await genericConvert(image, target, mode, options); if (converted.document.kind !== "raster") throw new RetroImageError("VALIDATION_FAILED", "Expected raster conversion"); converted.document.components.screen = encodePlanar(converted.document, mode); converted.report.steps.push({ operation: "st-bitplanes", message: "Packed raw Atari ST interleaved bitplanes" }); return converted; }
};

/** All built-in Atari ST/STE codecs. */
export const atariStPlugins: FormatPlugin[] = [atariStDegasPlugin, atariStDegasCompressedPlugin, atariStNeoPlugin, atariStRawPlugin];
