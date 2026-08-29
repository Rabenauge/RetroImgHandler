import { describe, expect, it } from "vitest";
import { createRegistry, indexedToRgba, type DisplayProfile, type RasterDocument, type RgbColor, type RgbaImage } from "../../src/index";
import { amigaPlugins } from "../../src/amiga";

const registry = createRegistry(amigaPlugins);

function chunk(data: Uint8Array, id: string): Uint8Array {
  let offset = 12;
  while (offset + 8 <= data.length) {
    const name = new TextDecoder().decode(data.subarray(offset, offset + 4));
    const size = new DataView(data.buffer, data.byteOffset + offset + 4, 4).getUint32(0);
    if (name === id) return data.slice(offset + 8, offset + 8 + size);
    offset += 8 + size + (size & 1);
  }
  throw new Error(`Missing ${id} chunk`);
}

function document(
  modeId: string,
  palette: RgbColor[],
  indices: Uint8Array,
  width: number,
  height: number,
  displayProfile: DisplayProfile,
  alpha?: Uint8Array
): RasterDocument {
  const preview = indexedToRgba(indices, width, height, palette);
  if (alpha) for (let pixel = 0; pixel < alpha.length; pixel += 1) preview.data[pixel * 4 + 3] = alpha[pixel]!;
  return {
    kind: "raster",
    formatId: "amiga.ilbm",
    modeId,
    width,
    height,
    pixelAspect: { numerator: 1, denominator: 1 },
    displayProfile,
    palette,
    indices,
    preview,
    components: {},
    metadata: {},
    warnings: [],
    preserved: []
  };
}

function paletteBytes(palette: RgbColor[]): Uint8Array {
  return Uint8Array.from(palette.flatMap(({ r, g, b }) => [r, g, b]));
}

function rgba(colors: Array<RgbColor & { a?: number }>, width = colors.length): RgbaImage {
  return {
    width,
    height: colors.length / width,
    data: Uint8ClampedArray.from(colors.flatMap(({ r, g, b, a = 255 }) => [r, g, b, a]))
  };
}

function consumeByteRun1Row(source: Uint8Array, start: number, expected: number): number {
  let offset = start;
  let output = 0;
  while (output < expected) {
    const control = source[offset++]!;
    const signed = control > 127 ? control - 256 : control;
    if (signed >= 0) {
      const count = signed + 1;
      expect(output + count).toBeLessThanOrEqual(expected);
      offset += count;
      output += count;
    } else if (signed !== -128) {
      const count = 1 - signed;
      expect(output + count).toBeLessThanOrEqual(expected);
      offset += 1;
      output += count;
    }
  }
  return offset;
}

describe("Amiga target capability declarations", () => {
  it.each([
    ["ocs-indexed", "OCS/ECS Lowres indexed", "low", 5, 32, 32, 4],
    ["ocs-hires-indexed", "OCS/ECS Hires indexed", "high", 4, 16, 16, 4],
    ["ocs-ehb", "OCS/ECS Extra Half-Brite Lowres", "low", 6, 64, 32, 4],
    ["ecs-superhires-indexed", "ECS SuperHires indexed", "super-high", 2, 4, 4, 2],
    ["aga-indexed", "AGA Lowres indexed", "low", 8, 256, 256, 8],
    ["aga-hires-indexed", "AGA Hires indexed", "high", 8, 256, 256, 8],
    ["aga-superhires-indexed", "AGA SuperHires indexed", "super-high", 8, 256, 256, 8]
  ] as const)("declares literal indexed limits for %s", (id, label, resolutionClass, bitsPerPixel, displayed, stored, componentBits) => {
    const mode = registry.getFormatDefinition("amiga.ilbm").modes.find((candidate) => candidate.id === id);
    expect(mode).toMatchObject({ id, label, resolutionClass, interlaceSupport: "optional", bitsPerPixel, maxColors: displayed });
    expect(mode?.palette).toMatchObject({
      displayColorLimit: displayed,
      storableColorEntries: stored,
      componentPrecision: [{ redBits: componentBits, greenBits: componentBits, blueBits: componentBits }]
    });
  });

  it.each([
    ["ocs-indexed", 320, [["pal", false, 44, 44, 256], ["pal", true, 44, 22, 512], ["ntsc", false, 44, 52, 200], ["ntsc", true, 44, 26, 400]]],
    ["ocs-hires-indexed", 640, [["pal", false, 22, 44, 256], ["pal", true, 22, 22, 512], ["ntsc", false, 22, 52, 200], ["ntsc", true, 22, 26, 400]]],
    ["ecs-superhires-indexed", 1280, [["pal", false, 11, 44, 256], ["pal", true, 11, 22, 512], ["ntsc", false, 11, 52, 200], ["ntsc", true, 11, 26, 400]]],
    ["aga-indexed", 320, [["pal", false, 44, 44, 256], ["pal", true, 44, 22, 512], ["ntsc", false, 44, 52, 200], ["ntsc", true, 44, 26, 400]]],
    ["aga-hires-indexed", 640, [["pal", false, 22, 44, 256], ["pal", true, 22, 22, 512], ["ntsc", false, 22, 52, 200], ["ntsc", true, 22, 26, 400]]],
    ["aga-superhires-indexed", 1280, [["pal", false, 11, 44, 256], ["pal", true, 11, 22, 512], ["ntsc", false, 11, 52, 200], ["ntsc", true, 11, 26, 400]]]
  ] as const)("declares exact PAL/NTSC and laced variants for %s", (id, pageWidth, variants) => {
    const mode = registry.getFormatDefinition("amiga.ilbm").modes.find((candidate) => candidate.id === id)!;
    expect(mode.displayVariants).toHaveLength(4);
    for (const [videoStandard, interlaced, xAspect, yAspect, pageHeight] of variants) {
      expect(mode.displayVariants).toContainEqual(expect.objectContaining({
        videoStandard,
        interlaced,
        nominalPageSize: { width: pageWidth, height: pageHeight },
        pixelAspect: { numerator: xAspect, denominator: yAspect }
      }));
    }
  });

  it("exposes stable ILBM and raw planar encoding variants", () => {
    expect(registry.getFormatDefinition("amiga.ilbm").encodingVariants).toEqual([
      { id: "uncompressed", label: "Uncompressed ILBM", encodeOptions: { compression: "none" } },
      { id: "byterun1", label: "ByteRun1 ILBM", encodeOptions: { compression: "byterun1" } }
    ]);
    expect(registry.getFormatDefinition("amiga.raw-planar").encodingVariants).toEqual([
      { id: "row-interleaved", label: "Row-interleaved planar", encodeOptions: { amigaPlanar: { layout: "row-interleaved" } } },
      { id: "plane-major", label: "Plane-major planar", encodeOptions: { amigaPlanar: { layout: "plane-major" } } }
    ]);
  });
});

describe("Amiga ILBM display variants and native bytes", () => {
  it.each([
    ["ocs-indexed", "pal", false, 0x0000, 44, 44, 320, 256],
    ["ocs-hires-indexed", "ntsc", true, 0x8004, 22, 26, 640, 400],
    ["ecs-superhires-indexed", "pal", false, 0x0020, 11, 44, 1280, 256],
    ["aga-indexed", "ntsc", false, 0x0000, 44, 52, 320, 200],
    ["aga-hires-indexed", "pal", true, 0x8004, 22, 22, 640, 512],
    ["aga-superhires-indexed", "ntsc", true, 0x0024, 11, 26, 1280, 400]
  ] as const)("writes BMHD/CAMG for %s %s laced=%s", async (modeId, videoStandard, interlaced, flags, xAspect, yAspect, pageWidth, pageHeight) => {
    const source = document(modeId, [{ r: 0, g: 0, b: 0 }, { r: 255, g: 255, b: 255 }], Uint8Array.of(0, 1), 2, 1, {
      hardware: modeId.startsWith("aga") ? "aga" : modeId.startsWith("ecs-") ? "ecs" : "ocs",
      videoStandard,
      interlaced
    });
    const encoded = await registry.encode(source, { compression: "none" });
    const bmhd = chunk(encoded.data, "BMHD");
    const view = new DataView(bmhd.buffer, bmhd.byteOffset, bmhd.byteLength);
    expect([bmhd[14], bmhd[15], view.getInt16(16), view.getInt16(18)]).toEqual([xAspect, yAspect, pageWidth, pageHeight]);
    expect(new DataView(chunk(encoded.data, "CAMG").buffer, chunk(encoded.data, "CAMG").byteOffset, 4).getUint32(0)).toBe(flags);
    const decoded = await registry.decode(encoded.data, { displayProfile: source.displayProfile });
    expect(decoded).toMatchObject({ modeId, displayProfile: source.displayProfile, pixelAspect: { numerator: xAspect, denominator: yAspect } });
  });

  it("writes mask/compression fields, preserves unused palette slots, and compresses every plane row independently", async () => {
    const palette = [{ r: 0, g: 0, b: 0 }, { r: 17, g: 17, b: 17 }, { r: 34, g: 34, b: 34 }, { r: 51, g: 51, b: 51 }];
    const indices = Uint8Array.from({ length: 17 * 2 }, (_, pixel) => pixel % 4);
    const alpha = Uint8Array.from({ length: indices.length }, (_, pixel) => pixel === 0 ? 0 : 255);
    const source = document("ocs-hires-indexed", palette, indices, 17, 2, { hardware: "ocs", videoStandard: "pal", interlaced: false }, alpha);
    const encoded = await registry.encode(source, { compression: "byterun1" });
    const bmhd = chunk(encoded.data, "BMHD");
    expect([bmhd[8], bmhd[9], bmhd[10]]).toEqual([2, 1, 1]);
    expect(chunk(encoded.data, "CMAP")).toEqual(paletteBytes(palette));
    const body = chunk(encoded.data, "BODY");
    let bodyOffset = 0;
    for (let row = 0; row < 2 * (2 + 1); row += 1) bodyOffset = consumeByteRun1Row(body, bodyOffset, 4);
    expect(bodyOffset).toBe(body.length);
    const decoded = await registry.decode(encoded.data, { displayProfile: source.displayProfile });
    if (decoded.kind !== "raster") throw new Error("Expected raster");
    expect(decoded.indices).toEqual(indices);
    expect(decoded.palette).toEqual(palette);
    expect(decoded.components.mask?.[0]).toBe(0);
    expect(decoded.preview.data[3]).toBe(0);
  });

  it("identifies chipset from explicit hardware first, then planes/CMAP precision, and warns only on ambiguous OCS/ECS defaults", async () => {
    const aga = document("aga-indexed", [{ r: 1, g: 2, b: 3 }], Uint8Array.of(0), 1, 1, { hardware: "aga", videoStandard: "pal" });
    const agaBytes = (await registry.encode(aga)).data;
    expect((await registry.decode(agaBytes)).modeId).toBe("aga-indexed");
    expect((await registry.decode(agaBytes, { displayProfile: { hardware: "ecs", videoStandard: "ntsc" } })).modeId).toBe("ocs-indexed");

    const ambiguous = document("ocs-indexed", [{ r: 0, g: 0, b: 0 }, { r: 17, g: 17, b: 17 }], Uint8Array.of(0), 1, 1, { hardware: "ocs", videoStandard: "pal" });
    const decoded = await registry.decode((await registry.encode(ambiguous)).data);
    expect(decoded.displayProfile.hardware).toBe("ocs");
    expect(decoded.warnings).toContainEqual(expect.objectContaining({ code: "ASSUMED_DISPLAY_PROFILE" }));
  });
});

describe("Amiga raw planar layouts", () => {
  const palette = [{ r: 0, g: 0, b: 0 }, { r: 17, g: 0, b: 0 }, { r: 0, g: 17, b: 0 }, { r: 17, g: 17, b: 0 }];
  const indices = Uint8Array.from([
    0, 1, 2, 3, 0, 1, 2, 3, 0, 1, 2, 3, 0, 1, 2, 3, 1,
    2, 3, 0, 1, 2, 3, 0, 1, 2, 3, 0, 1, 2, 3, 0, 2, 3
  ]);
  const mask = Uint8Array.from({ length: 34 }, (_, pixel) => pixel === 16 ? 0 : 1);

  it.each(["row-interleaved", "plane-major"] as const)("roundtrips padded rows, least-significant plane first, final mask plane, and palette sidecar in %s layout", async (layout) => {
    const source = document("ocs-indexed", palette, indices, 17, 2, { hardware: "ocs", videoStandard: "pal" });
    source.formatId = "amiga.raw-planar";
    source.components = { mask, palette: paletteBytes(palette) };
    const encoded = await registry.encode(source, { amigaPlanar: { layout } });
    expect(encoded.data).toHaveLength(4 * 3 * 2);
    const decoded = await registry.decode(encoded.data, {
      formatId: "amiga.raw-planar",
      modeId: "ocs-indexed",
      width: 17,
      height: 2,
      displayProfile: source.displayProfile,
      components: { palette: source.components.palette! },
      amigaPlanar: { layout, planes: 2, mask: true }
    });
    if (decoded.kind !== "raster") throw new Error("Expected raster");
    expect(decoded.indices).toEqual(indices);
    expect(decoded.components.mask).toEqual(mask);
    expect(decoded.components.palette).toEqual(paletteBytes(palette));
    expect(decoded.preview.data[16 * 4 + 3]).toBe(0);
    expect(decoded.metadata).toMatchObject({ planarLayout: layout, planes: 2, masking: 1 });
  });

  it("uses the same row-interleaved bytes as an uncompressed ILBM BODY", async () => {
    const source = document("ocs-indexed", palette, indices, 17, 2, { hardware: "ocs", videoStandard: "pal" });
    source.components.mask = mask;
    const ilbm = await registry.encode(source, { compression: "none" });
    source.formatId = "amiga.raw-planar";
    const raw = await registry.encode(source, { amigaPlanar: { layout: "row-interleaved" } });
    expect(raw.data).toEqual(chunk(ilbm.data, "BODY"));
  });
});

describe("Amiga strict/native and automatic conversion", () => {
  it("rejects off-grid OCS colors in Strict and maps them to the nearest RGB444 grid in Auto", async () => {
    const source = rgba([{ r: 8, g: 25, b: 42 }]);
    const target = { formatId: "amiga.ilbm", modeId: "ocs-indexed", displayProfile: { hardware: "ocs", videoStandard: "pal" as const, interlaced: false } };
    expect(registry.analyze(source, target).issues).toContainEqual(expect.objectContaining({ code: "COLOR_OUTSIDE_COMPONENT_GRID" }));
    const converted = await registry.convert(source, target, { dither: "none" });
    expect(converted.document.palette).toEqual([{ r: 0, g: 17, b: 34 }]);
  });

  it("validates EHB derived entries, stores only 32 base triplets, and preserves base order including unused slots", async () => {
    const base = Array.from({ length: 32 }, (_, index) => ({ r: index * 8, g: 0, b: 0 })).map(({ r, g, b }) => ({ r: Math.round(r / 17) * 17, g, b }));
    const derived = base.map(({ r, g, b }) => ({ r: r >>> 1, g: g >>> 1, b: b >>> 1 }));
    const source = document("ocs-ehb", [...base, ...derived], Uint8Array.of(0, 32), 2, 1, { hardware: "ocs", videoStandard: "pal" });
    expect(registry.analyze(source, { formatId: "amiga.ilbm", modeId: "ocs-ehb", displayProfile: source.displayProfile }).valid).toBe(true);
    const encoded = await registry.encode(source);
    expect(chunk(encoded.data, "CMAP")).toEqual(paletteBytes(base));
    const decoded = await registry.decode(encoded.data, { displayProfile: source.displayProfile });
    expect(decoded.palette).toEqual([...base, ...derived]);

    source.palette[32] = { r: 255, g: 255, b: 255 };
    source.preview = indexedToRgba(source.indices, source.width, source.height, source.palette);
    const invalid = registry.analyze(source, { formatId: "amiga.ilbm", modeId: "ocs-ehb", displayProfile: source.displayProfile });
    expect(invalid.issues).toContainEqual(expect.objectContaining({ code: "EHB_DERIVED_PALETTE_MISMATCH" }));
  });

  it("Auto creates usable EHB base and derived entries and maps without dithering", async () => {
    const colors = Array.from({ length: 32 }, (_, index) => ({ r: 255, g: (index & 15) * 17, b: index < 16 ? 0 : 17 }));
    const source = rgba([...colors, ...colors.map(({ r, g, b }) => ({ r: r >>> 1, g: g >>> 1, b: b >>> 1 }))]);
    const target = { formatId: "amiga.raw-planar", modeId: "ocs-ehb", displayProfile: { hardware: "ocs", videoStandard: "pal" as const, interlaced: false } };
    const converted = await registry.convert(source, target, { dither: "none" });
    if (converted.document.kind !== "raster") throw new Error("Expected raster");
    expect(converted.document.palette).toHaveLength(64);
    expect([...converted.document.indices].some((index) => index >= 32)).toBe(true);
    expect(converted.document.components.palette).toHaveLength(96);
  });

  it("accepts only binary alpha in Strict and thresholds alpha at 128 in Auto while omitting opaque masks", async () => {
    const target = { formatId: "amiga.raw-planar", modeId: "ocs-indexed", displayProfile: { hardware: "ocs", videoStandard: "pal" as const, interlaced: false } };
    expect(registry.analyze(rgba([{ r: 0, g: 0, b: 0, a: 127 }]), target).issues).toContainEqual(expect.objectContaining({ code: "NON_BINARY_ALPHA" }));
    const converted = await registry.convert(rgba([{ r: 0, g: 0, b: 0, a: 127 }, { r: 17, g: 17, b: 17, a: 128 }]), target, { dither: "none" });
    expect(converted.document.components.mask).toEqual(Uint8Array.of(0, 1));
    const opaque = await registry.convert(rgba([{ r: 0, g: 0, b: 0, a: 255 }]), target, { dither: "none" });
    expect(opaque.document.components.mask).toBeUndefined();
  });
});

describe("Amiga review regressions", () => {
  const ocsTarget = (formatId = "amiga.ilbm", modeId = "ocs-indexed") => ({
    formatId,
    modeId,
    displayProfile: { hardware: "ocs", videoStandard: "pal" as const, interlaced: false }
  });

  it("validates the complete stored palette, index semantics, and compatible plane metadata", async () => {
    const hiresPalette = Array.from({ length: 17 }, (_, index) => ({ r: (index & 15) * 17, g: (index >>> 4) * 17, b: 0 }));
    const tooMany = document("ocs-hires-indexed", hiresPalette, Uint8Array.of(0), 1, 1, { hardware: "ocs", videoStandard: "pal" });
    expect(registry.analyze(tooMany, ocsTarget("amiga.ilbm", "ocs-hires-indexed")).issues).toContainEqual(expect.objectContaining({ code: "PALETTE_CAPACITY_EXCEEDED" }));
    await expect(registry.encode(tooMany)).rejects.toMatchObject({ code: "VALIDATION_FAILED" });

    const unusedOffGrid = document("ocs-hires-indexed", [{ r: 0, g: 0, b: 0 }, { r: 1, g: 0, b: 0 }], Uint8Array.of(0), 1, 1, { hardware: "ocs", videoStandard: "pal" });
    expect(registry.analyze(unusedOffGrid, ocsTarget("amiga.ilbm", "ocs-hires-indexed")).issues).toContainEqual(expect.objectContaining({ code: "STORED_COLOR_OUTSIDE_COMPONENT_GRID" }));
    expect(registry.analyze(unusedOffGrid, { ...ocsTarget("amiga.ilbm", "ocs-hires-indexed"), displayProfile: { hardware: "aga", videoStandard: "pal", interlaced: false } }).issues).toContainEqual(expect.objectContaining({ code: "STORED_COLOR_OUTSIDE_COMPONENT_GRID" }));

    const badIndex = document("ocs-hires-indexed", Array.from({ length: 16 }, (_, index) => ({ r: index * 17, g: 0, b: 0 })), Uint8Array.of(16), 1, 1, { hardware: "ocs", videoStandard: "pal" });
    expect(registry.analyze(badIndex, ocsTarget("amiga.ilbm", "ocs-hires-indexed")).issues).toContainEqual(expect.objectContaining({ code: "INDEX_OUTSIDE_MODE_CAPACITY" }));

    const missingStored = document("ocs-indexed", [{ r: 0, g: 0, b: 0 }, { r: 17, g: 0, b: 0 }], Uint8Array.of(3), 1, 1, { hardware: "ocs", videoStandard: "pal" });
    expect(registry.analyze(missingStored, ocsTarget()).issues).toContainEqual(expect.objectContaining({ code: "INDEX_WITHOUT_STORED_COLOR" }));

    const badPlanes = document("ocs-hires-indexed", [{ r: 0, g: 0, b: 0 }, { r: 17, g: 0, b: 0 }], Uint8Array.of(1), 1, 1, { hardware: "ocs", videoStandard: "pal" });
    badPlanes.metadata.planes = 8;
    expect(registry.analyze(badPlanes, ocsTarget("amiga.ilbm", "ocs-hires-indexed")).issues).toContainEqual(expect.objectContaining({ code: "PLANE_COUNT_MISMATCH" }));
    await expect(registry.encode(badPlanes)).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
  });

  it("identifies HAM command width from six or eight planes independently of explicit chipset", async () => {
    const ham6 = document("ocs-ham6", [{ r: 0, g: 0, b: 0 }], Uint8Array.of(0), 1, 1, { hardware: "ocs", videoStandard: "pal" });
    ham6.metadata.planes = 6;
    const decoded6 = await registry.decode((await registry.encode(ham6)).data, { displayProfile: { hardware: "aga", videoStandard: "pal" } });
    expect(decoded6).toMatchObject({ modeId: "ocs-ham6", displayProfile: { hardware: "aga" }, metadata: { planes: 6 } });

    const ham8 = document("aga-ham8", [{ r: 1, g: 2, b: 3 }], Uint8Array.of(0), 1, 1, { hardware: "aga", videoStandard: "pal" });
    ham8.metadata.planes = 8;
    const decoded8 = await registry.decode((await registry.encode(ham8)).data, { displayProfile: { hardware: "ecs", videoStandard: "pal" } });
    expect(decoded8).toMatchObject({ modeId: "aga-ham8", displayProfile: { hardware: "ecs" }, metadata: { planes: 8 } });
  });

  it("infers exact NTSC laced timing from BMHD and preserves it without decode hints", async () => {
    const source = document("aga-hires-indexed", [{ r: 1, g: 2, b: 3 }], Uint8Array.of(0), 1, 1, { hardware: "aga", videoStandard: "ntsc", interlaced: true });
    const first = await registry.encode(source);
    const decoded = await registry.decode(first.data);
    expect(decoded.displayProfile).toMatchObject({ hardware: "aga", videoStandard: "ntsc", interlaced: true });
    expect(decoded.warnings).not.toContainEqual(expect.objectContaining({ code: "ASSUMED_DISPLAY_PROFILE" }));
    const second = await registry.encode(decoded);
    expect(chunk(second.data, "BMHD").slice(14, 20)).toEqual(chunk(first.data, "BMHD").slice(14, 20));
    expect(chunk(second.data, "CAMG")).toEqual(chunk(first.data, "CAMG"));
  });

  it("optimizes EHB bases by weighted base-plus-half error with a stable RGB tie rule", async () => {
    const mandatory = Array.from({ length: 31 }, (_, index) => ({
      r: 204 + (index % 4) * 17,
      g: 102 + (Math.floor(index / 4) % 4) * 17,
      b: 34 + (Math.floor(index / 16) % 2) * 17
    }));
    const colors = mandatory.flatMap((color) => Array.from({ length: 20 }, () => color));
    colors.push(...Array.from({ length: 10 }, () => ({ r: 85, g: 0, b: 0 })), { r: 170, g: 0, b: 0 });
    const source = rgba(colors);
    const target = ocsTarget("amiga.raw-planar", "ocs-ehb");
    const first = await registry.convert(source, target, { dither: "none" });
    const second = await registry.convert(source, target, { dither: "none" });
    expect(first.document.palette.slice(0, 32)).toContainEqual({ r: 170, g: 0, b: 0 });
    expect(first.document.palette.slice(0, 32)).not.toContainEqual({ r: 85, g: 0, b: 0 });
    expect(first.document.palette).toEqual(second.document.palette);
    if (first.document.kind !== "raster") throw new Error("Expected raster");
    expect(first.document.indices[colors.length - 11]).toBeGreaterThanOrEqual(32);
  });

  it("enforces flexible dimension boundaries and rejects values that could wrap BMHD", async () => {
    const boundary = document("ocs-indexed", [{ r: 0, g: 0, b: 0 }], new Uint8Array(4096), 4096, 1, { hardware: "ocs", videoStandard: "pal" });
    expect(registry.analyze(boundary, ocsTarget()).valid).toBe(true);
    expect((await registry.encode(boundary)).data.length).toBeGreaterThan(0);

    const oversize = document("ocs-indexed", [{ r: 0, g: 0, b: 0 }], new Uint8Array(4097), 4097, 1, { hardware: "ocs", videoStandard: "pal" });
    expect(registry.analyze(oversize, ocsTarget()).issues).toContainEqual(expect.objectContaining({ code: "DIMENSIONS_MISMATCH" }));
    await expect(registry.encode(oversize)).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    oversize.formatId = "amiga.raw-planar";
    expect(registry.analyze(oversize, ocsTarget("amiga.raw-planar")).issues).toContainEqual(expect.objectContaining({ code: "DIMENSIONS_MISMATCH" }));
    await expect(registry.encode(oversize)).rejects.toMatchObject({ code: "VALIDATION_FAILED" });

    const wrapped = document("aga-indexed", [{ r: 0, g: 0, b: 0 }], new Uint8Array(65_536), 65_536, 1, { hardware: "aga", videoStandard: "pal" });
    await expect(registry.encode(wrapped)).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    await expect(amigaPlugins[0]!.encode(wrapped, {})).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
  });

  it("emits independent literal row-interleaved and plane-major bytes", async () => {
    const palette = [{ r: 0, g: 0, b: 0 }, { r: 17, g: 0, b: 0 }, { r: 0, g: 17, b: 0 }, { r: 17, g: 17, b: 0 }];
    const indices = new Uint8Array(34);
    indices[0] = 1; indices[1] = 2; indices[16] = 3;
    indices[17] = 3; indices[25] = 1; indices[33] = 2;
    const mask = new Uint8Array(34);
    mask[0] = 1; mask[16] = 1; mask[25] = 1;
    const source = document("ocs-indexed", palette, indices, 17, 2, { hardware: "ocs", videoStandard: "pal" });
    source.formatId = "amiga.raw-planar";
    source.components.mask = mask;
    const p0r0 = [0x80, 0x00, 0x80, 0x00];
    const p1r0 = [0x40, 0x00, 0x80, 0x00];
    const mr0 = [0x80, 0x00, 0x80, 0x00];
    const p0r1 = [0x80, 0x80, 0x00, 0x00];
    const p1r1 = [0x80, 0x00, 0x80, 0x00];
    const mr1 = [0x00, 0x80, 0x00, 0x00];
    expect((await registry.encode(source, { amigaPlanar: { layout: "row-interleaved" } })).data).toEqual(Uint8Array.from([
      ...p0r0, ...p1r0, ...mr0, ...p0r1, ...p1r1, ...mr1
    ]));
    expect((await registry.encode(source, { amigaPlanar: { layout: "plane-major" } })).data).toEqual(Uint8Array.from([
      ...p0r0, ...p0r1, ...p1r0, ...p1r1, ...mr0, ...mr1
    ]));
  });
});
