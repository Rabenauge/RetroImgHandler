import { describe, expect, it } from "vitest";
import { createRegistry, indexedToRgba, type RasterDocument } from "../../src/index";
import { amigaPlugins } from "../../src/amiga";

function image(): RasterDocument {
  const indices = Uint8Array.from({ length: 32 * 8 }, (_, index) => index & 1);
  const palette = [{ r: 0, g: 0, b: 0 }, { r: 255, g: 255, b: 255 }];
  return { kind: "raster", formatId: "amiga.ilbm", modeId: "ocs-indexed", width: 32, height: 8, pixelAspect: { numerator: 1, denominator: 1 }, displayProfile: { hardware: "ocs", videoStandard: "pal" }, palette, indices, preview: indexedToRgba(indices, 32, 8, palette), components: {}, metadata: { planes: 1, camg: 0 }, warnings: [], preserved: [{ id: "ANNO", data: new TextEncoder().encode("test") }] };
}

describe("Amiga ILBM", () => {
  it("encodes and decodes uncompressed and ByteRun1 ILBM", async () => {
    const registry = createRegistry(amigaPlugins);
    for (const compression of ["none", "byterun1"] as const) {
      const encoded = await registry.encode(image(), { compression });
      expect(new TextDecoder().decode(encoded.data.subarray(0, 4))).toBe("FORM");
      const decoded = await registry.decode(encoded.data);
      if (decoded.kind !== "raster") throw new Error("Expected raster");
      expect(decoded.indices).toEqual(image().indices);
      expect(decoded.preserved[0]?.id).toBe("ANNO");
    }
  });

  it("requires hints for raw planes", async () => {
    await expect(createRegistry(amigaPlugins).decode(new Uint8Array(4), { formatId: "amiga.raw-planar" })).rejects.toMatchObject({ code: "MISSING_HINT" });
  });
});
