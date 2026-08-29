import { describe, expect, it } from "vitest";
import { createRegistry } from "../../src/index";
import { atari8Plugins } from "../../src/atari-8bit";

describe("Atari 8-bit formats", () => {
  it("decodes and roundtrips GR8", async () => {
    const source = new Uint8Array(7680);
    source[0] = 0x80;
    const registry = createRegistry(atari8Plugins);
    const image = await registry.decode(source, { formatId: "atari8.gr8" });
    if (image.kind !== "raster") throw new Error("Expected raster");
    expect(image.width).toBe(320);
    expect(image.indices[0]).not.toBe(image.indices[1]);
    expect((await registry.encode(image)).data).toEqual(source);
  });

  it("writes and reads an uncompressed Micro Illustrator PIC wrapper", async () => {
    const registry = createRegistry(atari8Plugins);
    const image = await registry.decode(new Uint8Array(7684), { formatId: "atari8.mic" });
    image.formatId = "atari8.pic";
    const encoded = await registry.encode(image);
    expect([...encoded.data.subarray(0, 4)]).toEqual([255, 128, 201, 199]);
    const decoded = await registry.decode(encoded.data);
    expect(decoded.width).toBe(160);
    expect(decoded.height).toBe(192);
  });
});
