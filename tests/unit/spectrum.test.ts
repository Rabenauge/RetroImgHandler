import { describe, expect, it } from "vitest";
import { createRegistry } from "../../src/index";
import { spectrumPlugins } from "../../src/spectrum";

describe("ZX Spectrum SCR", () => {
  it("detects, decodes, and byte-roundtrips native components", async () => {
    const source = new Uint8Array(6912);
    source[0] = 0xaa;
    source[6144] = 0b0100_0111;
    const registry = createRegistry(spectrumPlugins);
    expect((await registry.detect(source, { filename: "test.scr" }))[0]?.formatId).toBe("zx-spectrum.scr");
    const image = await registry.decode(source, { filename: "test.scr" });
    expect(image.preview.width).toBe(256);
    expect(image.components.attributes?.[0]).toBe(source[6144]);
    expect((await registry.encode(image)).data).toEqual(source);
  });

  it("rejects truncated screens", async () => {
    await expect(createRegistry(spectrumPlugins).decode(new Uint8Array(6911), { formatId: "zx-spectrum.scr" })).rejects.toMatchObject({ code: "INVALID_FILE" });
  });
});
