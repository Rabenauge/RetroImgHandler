import { describe, expect, it } from "vitest";
import { createRegistry, medianCut, RetroImageError } from "../../src/index";
import { spectrumPlugins } from "../../src/spectrum";

describe("core registry", () => {
  it("returns JSON-serializable format definitions", () => {
    const registry = createRegistry(spectrumPlugins);
    const definition = registry.getFormatDefinition("zx-spectrum.scr");
    expect(JSON.parse(JSON.stringify(definition))).toEqual(definition);
    expect(definition.modes[0]?.cell?.maxColors).toBe(2);
  });

  it("rejects duplicate plugin IDs", () => {
    expect(() => createRegistry([spectrumPlugins[0]!, spectrumPlugins[0]!])).toThrowError(RetroImageError);
  });

  it("enforces input limits before decode", async () => {
    const registry = createRegistry(spectrumPlugins);
    await expect(registry.decode(new Uint8Array(6912), { limits: { maxInputBytes: 100 } })).rejects.toMatchObject({ code: "LIMIT_EXCEEDED" });
  });

  it("creates a deterministic bounded median-cut palette", () => {
    const data = new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255]);
    expect(medianCut({ width: 4, height: 1, data }, 2)).toHaveLength(2);
    expect(medianCut({ width: 4, height: 1, data }, 2)).toEqual(medianCut({ width: 4, height: 1, data }, 2));
  });
});
