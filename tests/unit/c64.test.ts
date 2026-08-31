import { describe, expect, it } from "vitest";
import { createRegistry, indexedToRgba, type RasterDocument } from "../../src/index";
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
});
