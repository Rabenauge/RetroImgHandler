import { describe, expect, it } from "vitest";
import { createRegistry, indexedToRgba, type RasterDocument } from "../../src/index";
import { c64Palette, c64Plugins } from "../../src/c64";

function blank(formatId: string, modeId: string, width: number, height: number): RasterDocument {
  const indices = new Uint8Array(width * height);
  return { kind: "raster", formatId, modeId, width, height, pixelAspect: { numerator: modeId === "multicolor-bitmap" ? 2 : 1, denominator: 1 }, displayProfile: { hardware: "vic-ii", videoStandard: "pal" }, palette: c64Palette, indices, preview: indexedToRgba(indices, width, height, c64Palette), components: {}, metadata: {}, warnings: [], preserved: [] };
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
});
