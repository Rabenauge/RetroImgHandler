import { describe, expect, it } from "vitest";
import { createRegistry, indexedToRgba, RetroImageError, type RasterDocument } from "../../src/index";
import { c64Palette, c64Plugins, matchC64ColorCodes } from "../../src/c64";

function blank(formatId: string, modeId: string, width: number, height: number): RasterDocument {
  const indices = new Uint8Array(width * height);
  return { kind: "raster", formatId, modeId, width, height, pixelAspect: { numerator: modeId === "multicolor-bitmap" ? 2 : 1, denominator: 1 }, displayProfile: { hardware: "vic-ii", videoStandard: "pal" }, palette: c64Palette, indices, preview: indexedToRgba(indices, width, height, c64Palette), components: {}, metadata: {}, warnings: [], preserved: [] };
}

function rgba(width: number, height: number, color: { r: number; g: number; b: number }): { width: number; height: number; data: Uint8ClampedArray } {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let pixel = 0; pixel < width * height; pixel += 1) data.set([color.r, color.g, color.b, 255], pixel * 4);
  return { width, height, data };
}

function c64ReportEntry(value: unknown): { sourceColor: { r: number; g: number; b: number }; colorCode: number; distance: number; pinned: boolean } | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const entry = value as Record<string, unknown>;
  const sourceColor = entry.sourceColor;
  if (!sourceColor || typeof sourceColor !== "object" || Array.isArray(sourceColor)) return undefined;
  const color = sourceColor as Record<string, unknown>;
  if (typeof color.r !== "number" || typeof color.g !== "number" || typeof color.b !== "number") return undefined;
  if (typeof entry.colorCode !== "number" || typeof entry.distance !== "number" || typeof entry.pinned !== "boolean") return undefined;
  return { sourceColor: { r: color.r, g: color.g, b: color.b }, colorCode: entry.colorCode, distance: entry.distance, pinned: entry.pinned };
}

describe("C64 bitmap formats", () => {
  it.each([
    ["c64.koala", "multicolor-bitmap", 160, 200, 10003],
    ["c64.art-studio", "hires-bitmap", 320, 200, 9009],
    ["c64.doodle", "hires-bitmap", 320, 200, 9218]
  ] as const)("roundtrips %s", async (formatId, modeId, width, height, size) => {
    const registry = createRegistry(c64Plugins);
    const encoded = await registry.encode(blank(formatId, modeId, width, height));
    expect(encoded.data).toHaveLength(size);
    const decoded = await registry.decode(encoded.data, { formatId });
    if (decoded.kind !== "raster") throw new Error("Expected raster");
    expect(decoded.width).toBe(width);
    expect(decoded.height).toBe(height);
    expect(decoded.indices.every((value) => value === 0)).toBe(true);
  });

  it("matches colors in OKLab with lower-code ties and retained pins", () => {
    const palette = Array.from({ length: 16 }, () => ({ r: 0, g: 0, b: 0 }));
    palette[2] = { r: 255, g: 255, b: 255 };
    palette[7] = { r: 255, g: 255, b: 255 };
    palette[15] = { r: 12, g: 34, b: 56 };

    const result = matchC64ColorCodes([
      { color: { r: 255, g: 255, b: 255 }, weight: 2 },
      { color: { r: 12, g: 34, b: 56 }, weight: 1, pinnedColorCode: 15 }
    ], palette);

    expect(result.matches).toEqual([
      { colorCode: 2, distance: 0, pinned: false },
      { colorCode: 15, distance: 0, pinned: true }
    ]);
    expect(result.weightedMeanDistance).toBe(0);
  });

  it("rejects C64 display palettes that do not expose every native code", () => {
    expect(() => matchC64ColorCodes([{ color: { r: 0, g: 0, b: 0 } }], c64Palette.slice(0, 15))).toThrow(/exactly 16/i);
  });

  it("converts source colors to pinned native codes and decodes them with the selected display palette", async () => {
    const registry = createRegistry(c64Plugins);
    const source = rgba(160, 200, { r: 24, g: 48, b: 72 });
    const displayPalette = c64Palette.map((color) => ({ ...color }));
    displayPalette[11] = { r: 3, g: 5, b: 7 };

    const converted = await registry.convert(source, {
      formatId: "c64.koala",
      modeId: "multicolor-bitmap",
      displayProfile: { hardware: "vic-ii", videoStandard: "pal" }
    }, {
      dither: "none",
      c64: { displayPalette, sourceColorCodes: [{ sourceColor: { r: 24, g: 48, b: 72 }, colorCode: 11, pinned: true }] }
    });

    expect(converted.report.steps).toContainEqual(expect.objectContaining({ operation: "c64-color-code-map" }));
    expect(converted.document.palette).toEqual(displayPalette);
    if (converted.document.kind !== "raster") throw new Error("Expected raster");
    expect(converted.document.indices[0]).toBe(11);
    expect(converted.document.preview.data.slice(0, 4)).toEqual(new Uint8ClampedArray([3, 5, 7, 255]));
  });

  it("retains a supplied VIC-II border code separately from bitmap colors", async () => {
    const registry = createRegistry(c64Plugins);
    const converted = await registry.convert(rgba(160, 200, c64Palette[2]!), {
      formatId: "c64.koala",
      modeId: "multicolor-bitmap",
      displayProfile: { hardware: "vic-ii", videoStandard: "pal" }
    }, { dither: "none", c64: { displayPalette: c64Palette, borderColorCode: 14 } });

    if (converted.document.kind !== "raster") throw new Error("Expected raster");
    expect(converted.document.metadata.c64BorderColorCode).toBe(14);
    expect(converted.document.components.border).toEqual(Uint8Array.of(14));
    expect(converted.report.steps).toContainEqual(expect.objectContaining({
      operation: "c64-border-color",
      details: { colorCode: 14 }
    }));
  });

  it("does not invent a C64 border component when its option is omitted", async () => {
    const registry = createRegistry(c64Plugins);
    const converted = await registry.convert(rgba(160, 200, c64Palette[2]!), {
      formatId: "c64.koala",
      modeId: "multicolor-bitmap",
      displayProfile: { hardware: "vic-ii", videoStandard: "pal" }
    }, { dither: "none", c64: { displayPalette: c64Palette } });

    if (converted.document.kind !== "raster") throw new Error("Expected raster");
    expect(converted.document.metadata.c64BorderColorCode).toBeUndefined();
    expect(converted.document.components.border).toBeUndefined();
  });

  it.each([-1, 16, 1.5])("rejects invalid C64 border color code %s", async (borderColorCode) => {
    const registry = createRegistry(c64Plugins);

    await expect(registry.convert(rgba(160, 200, c64Palette[2]!), {
      formatId: "c64.koala",
      modeId: "multicolor-bitmap",
      displayProfile: { hardware: "vic-ii", videoStandard: "pal" }
    }, { dither: "none", c64: { displayPalette: c64Palette, borderColorCode } })).rejects.toMatchObject({ code: "INVALID_OPTION" });
  });

  it("retains a sanitized Raw C64 border component and metadata", async () => {
    const registry = createRegistry(c64Plugins);
    const bitmap = new Uint8Array(8000);
    const screen = new Uint8Array(1000);
    const decoded = await registry.decode(bitmap, {
      formatId: "c64.raw",
      modeId: "hires-bitmap",
      components: { screen, border: Uint8Array.of(0xf5) }
    });

    if (decoded.kind !== "raster") throw new Error("Expected raster");
    expect(decoded.metadata.c64BorderColorCode).toBe(5);
    expect(decoded.components.border).toEqual(Uint8Array.of(5));
    const encoded = await registry.encode(decoded);
    expect(encoded.data).toEqual(bitmap);
    const roundtripped = await registry.decode(encoded.data, {
      formatId: "c64.raw",
      modeId: "hires-bitmap",
      components: decoded.components
    });
    if (roundtripped.kind !== "raster") throw new Error("Expected raster");
    expect(roundtripped.metadata.c64BorderColorCode).toBe(5);
    expect(roundtripped.components.border).toEqual(Uint8Array.of(5));
  });

  it("retains a sanitized Raw Multicolor C64 border component and metadata", async () => {
    const registry = createRegistry(c64Plugins);
    const bitmap = new Uint8Array(8000);
    const decoded = await registry.decode(bitmap, {
      formatId: "c64.raw",
      modeId: "multicolor-bitmap",
      components: {
        screen: new Uint8Array(1000),
        colorRam: new Uint8Array(1000),
        background: Uint8Array.of(0xf3),
        border: Uint8Array.of(0xfe)
      }
    });

    if (decoded.kind !== "raster") throw new Error("Expected raster");
    expect(decoded.metadata.c64BorderColorCode).toBe(14);
    expect(decoded.components.border).toEqual(Uint8Array.of(14));
    const roundtripped = await registry.decode((await registry.encode(decoded)).data, {
      formatId: "c64.raw",
      modeId: "multicolor-bitmap",
      components: decoded.components
    });
    if (roundtripped.kind !== "raster") throw new Error("Expected raster");
    expect(roundtripped.metadata.c64BorderColorCode).toBe(14);
    expect(roundtripped.components.border).toEqual(Uint8Array.of(14));
  });

  it("rejects Raw C64 border components that do not contain exactly one byte", async () => {
    const registry = createRegistry(c64Plugins);

    await expect(registry.decode(new Uint8Array(8000), {
      formatId: "c64.raw",
      modeId: "hires-bitmap",
      components: { screen: new Uint8Array(1000), border: Uint8Array.of(1, 2) }
    })).rejects.toMatchObject({ code: "INVALID_OPTION" });
  });

  it("reports the cell and pinned native codes when C64 hires packing is impossible", async () => {
    const registry = createRegistry(c64Plugins);
    const source = rgba(320, 200, { r: 10, g: 10, b: 10 });
    source.data.set([20, 20, 20, 255], 4);
    source.data.set([30, 30, 30, 255], 8);

    await expect(registry.convert(source, {
      formatId: "c64.art-studio",
      modeId: "hires-bitmap",
      displayProfile: { hardware: "vic-ii", videoStandard: "pal" }
    }, {
      dither: "none",
      c64: {
        displayPalette: c64Palette,
        sourceColorCodes: [
          { sourceColor: { r: 10, g: 10, b: 10 }, colorCode: 1, pinned: true },
          { sourceColor: { r: 20, g: 20, b: 20 }, colorCode: 2, pinned: true },
          { sourceColor: { r: 30, g: 30, b: 30 }, colorCode: 3, pinned: true }
        ]
      }
    })).rejects.toMatchObject({ code: "VALIDATION_FAILED", details: { x: 0, y: 0, codes: [1, 2, 3] } });
  });

  it("retains legacy C64 conversion bytes when no C64 options are supplied", async () => {
    const registry = createRegistry(c64Plugins);
    const converted = await registry.convert(rgba(160, 200, c64Palette[2]!), {
      formatId: "c64.koala",
      modeId: "multicolor-bitmap",
      displayProfile: { hardware: "vic-ii", videoStandard: "pal" }
    }, { dither: "none" });
    const encoded = await registry.encode(converted.document);

    expect(encoded.data[10002]).toBe(2);
  });

  it.each([
    ["c64.koala", "multicolor-bitmap", 160, 200],
    ["c64.art-studio", "hires-bitmap", 320, 200],
    ["c64.doodle", "hires-bitmap", 320, 200]
  ] as const)("keeps %s bytes unchanged when conversion records a separate border code", async (formatId, modeId, width, height) => {
    const registry = createRegistry(c64Plugins);
    const target = { formatId, modeId, displayProfile: { hardware: "vic-ii" as const, videoStandard: "pal" as const } };
    const source = rgba(width, height, c64Palette[2]!);
    const withoutBorder = await registry.convert(source, target, { dither: "none", c64: { displayPalette: c64Palette } });
    const withBorder = await registry.convert(source, target, { dither: "none", c64: { displayPalette: c64Palette, borderColorCode: 14 } });

    expect((await registry.encode(withBorder.document)).data).toEqual((await registry.encode(withoutBorder.document)).data);
  });

  it("encodes native C64 indices without rematching a misleading preview", async () => {
    const registry = createRegistry(c64Plugins);
    const koala = new Uint8Array(10003);
    koala.set([0x00, 0x60]);
    koala[10002] = 9;
    const document = await registry.decode(koala, { formatId: "c64.koala" });
    if (document.kind !== "raster") throw new Error("Expected raster");
    document.preview = rgba(160, 200, { r: 0, g: 0, b: 0 });

    const encoded = await registry.encode(document);

    expect(encoded.data[10002]).toBe(9);
  });

  it("keeps same-size decoded C64 native codes when a configured display palette changes", async () => {
    const registry = createRegistry(c64Plugins);
    const koala = new Uint8Array(10003);
    koala.set([0x00, 0x60]);
    koala[10002] = 9;
    const source = await registry.decode(koala, { formatId: "c64.koala" });
    const displayPalette = c64Palette.map((color) => ({ ...color }));
    displayPalette[0] = { ...c64Palette[9]! };
    displayPalette[9] = { r: 3, g: 5, b: 7 };

    const converted = await registry.convert(source, {
      formatId: "c64.koala",
      modeId: "multicolor-bitmap",
      displayProfile: { hardware: "vic-ii", videoStandard: "pal" }
    }, { dither: "none", c64: { displayPalette } });

    if (converted.document.kind !== "raster") throw new Error("Expected raster");
    expect(converted.document.indices[0]).toBe(9);
    expect(converted.document.preview.data.slice(0, 4)).toEqual(new Uint8ClampedArray([3, 5, 7, 255]));
    expect((await registry.encode(converted.document)).data[10002]).toBe(9);
  });

  it("retains same-size native C64 pins while packing a configured conversion", async () => {
    const registry = createRegistry(c64Plugins);
    const source = blank("c64.koala", "multicolor-bitmap", 160, 200);
    source.metadata.c64NativeColorCodes = true;
    source.indices.set([1, 2, 3, 4]);
    const pins = new Uint8Array(source.indices.length).fill(255);
    pins[3] = 4;
    source.components.c64PinnedCodes = pins;

    const converted = await registry.convert(source, {
      formatId: "c64.koala",
      modeId: "multicolor-bitmap",
      displayProfile: { hardware: "vic-ii", videoStandard: "pal" }
    }, { dither: "none", c64: { displayPalette: c64Palette } });

    if (converted.document.kind !== "raster") throw new Error("Expected raster");
    expect(converted.document.indices[3]).toBe(4);
  });

  it("rejects configured native C64 raster resizing instead of rematching its preview", async () => {
    const registry = createRegistry(c64Plugins);
    const source = blank("c64.art-studio", "hires-bitmap", 320, 200);
    source.indices.fill(9);
    source.metadata.c64NativeColorCodes = true;

    const error = await registry.convert(source, {
      formatId: "c64.koala",
      modeId: "multicolor-bitmap",
      displayProfile: { hardware: "vic-ii", videoStandard: "pal" }
    }, { resize: "nearest", dither: "none", c64: { displayPalette: c64Palette } }).catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(RetroImageError);
    if (!(error instanceof RetroImageError)) throw new Error("Expected RetroImageError");
    expect(error.code).toBe("VALIDATION_FAILED");
    expect(error.message).toMatch(/native C64 raster.*resize/i);
  });

  it("reports source RGB with pinned and unpinned native color-code mappings", async () => {
    const registry = createRegistry(c64Plugins);
    const source = rgba(160, 200, { r: 24, g: 48, b: 72 });
    source.data.set([80, 100, 120, 255], 4);

    const converted = await registry.convert(source, {
      formatId: "c64.koala",
      modeId: "multicolor-bitmap",
      displayProfile: { hardware: "vic-ii", videoStandard: "pal" }
    }, {
      dither: "none",
      c64: {
        displayPalette: c64Palette,
        sourceColorCodes: [
          { sourceColor: { r: 24, g: 48, b: 72 }, colorCode: 2, pinned: true },
          { sourceColor: { r: 80, g: 100, b: 120 }, colorCode: 3 }
        ]
      }
    });
    const report = converted.report.steps.find(({ operation }) => operation === "c64-color-code-map");
    const details = report?.details;
    if (!details || typeof details !== "object" || Array.isArray(details)) throw new Error("Expected mapping report details");
    const matches = (details as Record<string, unknown>).matches;
    if (!Array.isArray(matches)) throw new Error("Expected mapping report entries");
    const entries = matches.map(c64ReportEntry).filter((entry): entry is NonNullable<typeof entry> => entry !== undefined);
    const pinned = entries.find(({ colorCode }) => colorCode === 2);
    const unpinned = entries.find(({ colorCode }) => colorCode === 3);

    expect(pinned).toMatchObject({ sourceColor: { r: 24, g: 48, b: 72 }, colorCode: 2, pinned: true });
    expect(unpinned).toMatchObject({ sourceColor: { r: 80, g: 100, b: 120 }, colorCode: 3, pinned: false });
    expect(pinned?.distance).toBeTypeOf("number");
    expect(unpinned?.distance).toBeTypeOf("number");
  });
});
