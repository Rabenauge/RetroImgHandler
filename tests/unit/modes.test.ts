import { describe, expect, it } from "vitest";
import { createRegistry, indexedToRgba, type RasterDocument } from "../../src/index";
import { amigaPlugins } from "../../src/amiga";
import { atari8Plugins } from "../../src/atari-8bit";
import { atariStPlugins } from "../../src/atari-st";
import { c64Palette, c64Plugins } from "../../src/c64";

describe("declared hardware mode coverage", () => {
  it.each([
    ["ocs-indexed", 5, 0, 32],
    ["ocs-ehb", 6, 0x80, 32],
    ["ocs-ham6", 6, 0x800, 16],
    ["aga-indexed", 8, 0, 256],
    ["aga-ham8", 8, 0x800, 64]
  ] as const)("roundtrips Amiga %s", async (modeId, planes, camg, colors) => {
    const palette = Array.from({ length: colors }, (_, value) => modeId.startsWith("aga")
      ? { r: value, g: value, b: value }
      : { r: (value & 15) * 17, g: (value >>> 4) * 17, b: 0 });
    const indices = new Uint8Array(16 * 2);
    const document: RasterDocument = { kind: "raster", formatId: "amiga.ilbm", modeId, width: 16, height: 2, pixelAspect: { numerator: 1, denominator: 1 }, displayProfile: { hardware: modeId.startsWith("aga") ? "aga" : "ocs", videoStandard: "pal" }, palette, indices, preview: indexedToRgba(indices, 16, 2, palette), components: {}, metadata: { planes, camg }, warnings: [], preserved: [] };
    const registry = createRegistry(amigaPlugins);
    const decoded = await registry.decode((await registry.encode(document, { compression: "byterun1" })).data);
    expect(decoded.modeId).toBe(modeId);
  });

  it.each(["standard-char", "multicolor-char", "extended-background-char"])("roundtrips C64 %s memory", async (modeId) => {
    const charset = new Uint8Array(2048);
    charset[0] = 0xff;
    const components = { screen: new Uint8Array(1000), colorRam: new Uint8Array(1000), background: Uint8Array.of(0), backgrounds: Uint8Array.of(0, 1, 2, 3) };
    const registry = createRegistry(c64Plugins);
    const decoded = await registry.decode(charset, { formatId: "c64.raw", modeId, components, palette: c64Palette });
    expect(decoded.kind).toBe("charset");
    expect((await registry.encode(decoded)).data).toEqual(charset);
  });

  it.each([
    ["st-low", 320, 200],
    ["st-medium", 640, 200],
    ["st-high", 640, 400]
  ] as const)("roundtrips Atari %s raw planes", async (modeId, width, height) => {
    const registry = createRegistry(atariStPlugins);
    const palette = Array.from({ length: modeId === "st-low" ? 16 : modeId === "st-medium" ? 4 : 2 }, (_, value) => ({ r: value * 16, g: value * 16, b: value * 16 }));
    const decoded = await registry.decode(new Uint8Array(32000), { formatId: "atari-st.raw-planar", modeId, palette, displayProfile: { hardware: "ste", videoStandard: "pal" } });
    expect([decoded.width, decoded.height]).toEqual([width, height]);
    expect((await registry.encode(decoded)).data).toHaveLength(32000);
  });

  it("roundtrips every declared Atari 8-bit raw mode", async () => {
    const registry = createRegistry(atari8Plugins);
    const definition = registry.getFormatDefinition("atari8.raw");
    for (const mode of definition.modes) {
      const text = mode.colorModel === "character";
      const charset = new Uint8Array(mode.id === "antic-6-text" || mode.id === "antic-7-text" ? 512 : 1024);
      const rows = mode.id === "antic-3-text" ? 20 : 192 / (mode.cell?.height ?? 1);
      const screenColumns = mode.id === "antic-6-text" || mode.id === "antic-7-text" ? 20 : 40;
      const data = text ? charset : new Uint8Array(mode.dimensions[0]!.width * mode.dimensions[0]!.height * mode.bitsPerPixel / 8);
      const components = text ? { screen: new Uint8Array(screenColumns * rows), palette: Uint8Array.of(0, 40, 136, 202, 14) } : { palette: Uint8Array.of(0, 40, 136, 202, 14, 72, 104, 184, 216) };
      const decoded = await registry.decode(data, { formatId: "atari8.raw", modeId: mode.id, components, displayProfile: { hardware: "antic-gtia", videoStandard: "pal" } });
      expect(decoded.modeId).toBe(mode.id);
      expect((await registry.encode(decoded)).data.length).toBeGreaterThan(0);
    }
  });
});

describe("malformed input handling", () => {
  it.each([
    [amigaPlugins, "amiga.ilbm"],
    [c64Plugins, "c64.koala"],
    [atariStPlugins, "atari-st.degas"],
    [atari8Plugins, "atari8.pic"]
  ] as const)("rejects truncated %s input", async (plugins, formatId) => {
    await expect(createRegistry([...plugins]).decode(new Uint8Array(3), { formatId })).rejects.toBeInstanceOf(Error);
  });
});
