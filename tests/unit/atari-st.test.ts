import { describe, expect, it } from "vitest";
import { createRegistry, indexedToRgba, RetroImageError, type RasterDocument } from "../../src/index";
import { atariStPlugins } from "../../src/atari-st";

const modes = [
  { id: "st-low", width: 320, height: 200, colors: 16, suffix: 1 },
  { id: "st-medium", width: 640, height: 200, colors: 4, suffix: 2 },
  { id: "st-high", width: 640, height: 400, colors: 2, suffix: 3 }
] as const;

function stImage(formatId: string, mode: (typeof modes)[number] = modes[0]): RasterDocument {
  const indices = new Uint8Array(mode.width * mode.height);
  for (let i = 0; i < indices.length; i += 997) indices[i] = i % mode.colors;
  const palette = mode.id === "st-high"
    ? [{ r: 255, g: 255, b: 255 }, { r: 0, g: 0, b: 0 }]
    : Array.from({ length: mode.colors }, (_, i) => ({ r: i * 17, g: i * 17, b: i * 17 }));
  return {
    kind: "raster",
    formatId,
    modeId: mode.id,
    width: mode.width,
    height: mode.height,
    pixelAspect: mode.id === "st-medium" ? { numerator: 1, denominator: 2 } : { numerator: 1, denominator: 1 },
    displayProfile: { hardware: "ste", videoStandard: "pal" },
    palette,
    indices,
    preview: indexedToRgba(indices, mode.width, mode.height, palette),
    components: {},
    metadata: {},
    warnings: [],
    preserved: []
  };
}

function append(data: Uint8Array, suffix: Uint8Array): Uint8Array {
  const output = new Uint8Array(data.length + suffix.length);
  output.set(data);
  output.set(suffix, data.length);
  return output;
}

const planePatterns = [0xaa, 0xcc, 0xf0, 0x0f] as const;

function referenceIndices(mode: (typeof modes)[number]): Uint8Array {
  const indices = new Uint8Array(mode.width * mode.height);
  const planes = Math.log2(mode.colors);
  for (let y = 0; y < mode.height; y += 1) {
    for (let x = 0; x < mode.width; x += 1) {
      let value = 0;
      for (let plane = 0; plane < planes; plane += 1) {
        if (planePatterns[plane]! & (0x80 >>> (x & 7))) value |= 1 << plane;
      }
      indices[y * mode.width + x] = value;
    }
  }
  return indices;
}

function referencePcScreen(mode: (typeof modes)[number]): Uint8Array {
  const screen = new Uint8Array(32000);
  const planes = Math.log2(mode.colors);
  const planeRowBytes = mode.width / 8;
  const rowBytes = planeRowBytes * planes;
  for (let y = 0; y < mode.height; y += 1) {
    for (let plane = 0; plane < planes; plane += 1) {
      screen.fill(planePatterns[plane]!, y * rowBytes + plane * planeRowBytes, y * rowBytes + (plane + 1) * planeRowBytes);
    }
  }
  return screen;
}

function referencePcFile(mode: (typeof modes)[number]): Uint8Array {
  const screen = referencePcScreen(mode);
  const output = new Uint8Array(34 + screen.length / 40 * 2);
  output[0] = 0x80;
  output[1] = mode.suffix - 1;
  let target = 34;
  for (let source = 0; source < screen.length; source += 40) {
    output[target++] = 257 - 40;
    output[target++] = screen[source]!;
  }
  return output;
}

function referenceUnpackPc(data: Uint8Array): { screen: Uint8Array; commandsCrossing40Bytes: number } {
  const screen = new Uint8Array(32000);
  let source = 34;
  let target = 0;
  let commandsCrossing40Bytes = 0;
  while (target < screen.length) {
    const unsigned = data[source++]!;
    const control = unsigned > 127 ? unsigned - 256 : unsigned;
    if (control === -128) continue;
    const count = control >= 0 ? control + 1 : 1 - control;
    if (Math.floor(target / 40) !== Math.floor((target + count - 1) / 40)) commandsCrossing40Bytes += 1;
    if (control >= 0) {
      screen.set(data.subarray(source, source + count), target);
      source += count;
    } else {
      screen.fill(data[source++]!, target, target + count);
    }
    target += count;
  }
  return { screen, commandsCrossing40Bytes };
}

function eliteFooter(): Uint8Array {
  const footer = new Uint8Array(32);
  const view = new DataView(footer.buffer);
  [0, 4, 8, 12, 3, 7, 11, 15, 0, 1, 2, 1, 128, 84, 42, 0]
    .forEach((value, index) => view.setUint16(index * 2, value));
  return footer;
}

describe("Atari ST DEGAS formats", () => {
  it.each(modes)("roundtrips PI$suffix $id", async (mode) => {
    const registry = createRegistry(atariStPlugins);
    const source = stImage("atari-st.degas", mode);
    const encoded = await registry.encode(source);
    expect(encoded.data).toHaveLength(32034);
    expect(new DataView(encoded.data.buffer, encoded.data.byteOffset).getUint16(0)).toBe(mode.suffix - 1);
    const decoded = await registry.decode(encoded.data, { filename: `picture.pi${mode.suffix}`, displayProfile: source.displayProfile });
    expect(decoded.formatId).toBe("atari-st.degas");
    expect(decoded.modeId).toBe(mode.id);
    expect((decoded as RasterDocument).indices).toEqual(source.indices);
  });

  it.each(modes)("roundtrips PC$suffix $id", async (mode) => {
    const registry = createRegistry(atariStPlugins);
    const source = stImage("atari-st.degas-compressed", mode);
    const encoded = await registry.encode(source);
    expect(encoded.data.length).toBeLessThan(32034);
    expect(new DataView(encoded.data.buffer, encoded.data.byteOffset).getUint16(0)).toBe(0x8000 | (mode.suffix - 1));
    const decoded = await registry.decode(encoded.data, { filename: `picture.pc${mode.suffix}`, displayProfile: source.displayProfile });
    expect(decoded.formatId).toBe("atari-st.degas-compressed");
    expect(decoded.modeId).toBe(mode.id);
    expect((decoded as RasterDocument).indices).toEqual(source.indices);
  });

  it.each(modes)("decodes independently constructed PC$suffix scanline-plane data", async (mode) => {
    const decoded = await createRegistry(atariStPlugins).decode(referencePcFile(mode), {
      filename: `reference.pc${mode.suffix}`,
      displayProfile: { hardware: "st", videoStandard: "pal" }
    });
    expect(decoded.modeId).toBe(mode.id);
    expect((decoded as RasterDocument).indices).toEqual(referenceIndices(mode));
  });

  it.each(modes)("encodes PC$suffix in scanline-plane order with 40-byte PackBits boundaries", async (mode) => {
    const source = stImage("atari-st.degas-compressed", mode);
    source.indices = referenceIndices(mode);
    source.preview = indexedToRgba(source.indices, mode.width, mode.height, source.palette);
    const encoded = await createRegistry(atariStPlugins).encode(source);
    const unpacked = referenceUnpackPc(encoded.data);
    expect(unpacked.screen).toEqual(referencePcScreen(mode));
    expect(unpacked.commandsCrossing40Bytes).toBe(0);
  });

  it.each(["atari-st.degas", "atari-st.degas-compressed"])("preserves the DEGAS Elite footer for %s", async (formatId) => {
    const registry = createRegistry(atariStPlugins);
    const source = stImage(formatId);
    source.components.colorAnimation = Uint8Array.from({ length: 32 }, (_, index) => index);
    const encoded = await registry.encode(source);
    const decoded = await registry.decode(encoded.data, { formatId, displayProfile: source.displayProfile });
    expect(decoded.components.colorAnimation).toEqual(source.components.colorAnimation);
    expect((await registry.encode(decoded)).data).toEqual(encoded.data);
  });

  it("rejects an invalid Elite footer length on encode", async () => {
    const source = stImage("atari-st.degas");
    source.components.colorAnimation = new Uint8Array(31);
    await expect(createRegistry(atariStPlugins).encode(source)).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
  });

  it.each([1, 33, 55, 120, 142, 143, 295])("detects and preserves an opaque %i-byte PC trailer", async (length) => {
    const registry = createRegistry(atariStPlugins);
    const encoded = await registry.encode(stImage("atari-st.degas-compressed"));
    const trailer = new Uint8Array(length).fill(0xff);
    const file = append(encoded.data, trailer);
    expect(await registry.detect(file, { filename: "trailer.bin" })).toEqual([
      expect.objectContaining({ formatId: "atari-st.degas-compressed" })
    ]);
    const decoded = await registry.decode(file, { filename: "trailer.bin", displayProfile: { hardware: "st", videoStandard: "pal" } });
    expect(decoded.components.colorAnimation).toBeUndefined();
    expect(decoded.preserved).toEqual([{ id: "degas.trailing", data: trailer }]);
    expect(decoded.warnings).toContainEqual({
      code: "UNKNOWN_TRAILING_DATA",
      message: `Preserved ${length} ${length === 1 ? "byte" : "bytes"} after the DEGAS image.`,
      details: { bytes: length, eliteFooterSeparated: false }
    });
  });

  it("separates a valid Elite footer from unknown trailing bytes", async () => {
    const registry = createRegistry(atariStPlugins);
    const encoded = await registry.encode(stImage("atari-st.degas-compressed"));
    const footer = eliteFooter();
    const unknown = Uint8Array.of(0xde, 0xad, 0xbe, 0xef);
    const decoded = await registry.decode(append(append(encoded.data, footer), unknown), {
      formatId: "atari-st.degas-compressed",
      displayProfile: { hardware: "st", videoStandard: "pal" }
    });
    expect(decoded.components.colorAnimation).toEqual(footer);
    expect(decoded.preserved).toEqual([{ id: "degas.trailing", data: unknown }]);
    expect(decoded.warnings).toContainEqual({
      code: "UNKNOWN_TRAILING_DATA",
      message: "Preserved 4 bytes after the DEGAS image and Elite footer.",
      details: { bytes: 4, eliteFooterSeparated: true }
    });
  });

  it("keeps an exact 32-byte trailer as an Elite footer without an unknown-data warning", async () => {
    const registry = createRegistry(atariStPlugins);
    const encoded = await registry.encode(stImage("atari-st.degas-compressed"));
    const unusualFooter = new Uint8Array(32).fill(0xff);
    const decoded = await registry.decode(append(encoded.data, unusualFooter), {
      formatId: "atari-st.degas-compressed",
      displayProfile: { hardware: "st", videoStandard: "pal" }
    });
    expect(decoded.components.colorAnimation).toEqual(unusualFooter);
    expect(decoded.preserved).toEqual([]);
    expect(decoded.warnings.some(({ code }) => code === "UNKNOWN_TRAILING_DATA")).toBe(false);
  });

  it("omits unknown trailers by default and reports the omission", async () => {
    const registry = createRegistry(atariStPlugins);
    const source = stImage("atari-st.degas-compressed");
    source.components.colorAnimation = eliteFooter();
    source.preserved = [{ id: "degas.trailing", data: Uint8Array.of(1, 2, 3) }];
    for (const options of [{}, { preserveUnknown: false }]) {
      const encoded = await registry.encode(source, options);
      expect(encoded.data.subarray(-32)).toEqual(source.components.colorAnimation);
      expect(encoded.warnings).toEqual([{
        code: "UNKNOWN_DATA_OMITTED",
        message: "Omitted 3 preserved trailing bytes from DEGAS output.",
        details: { bytes: 3 }
      }]);
    }
  });

  it("re-encodes multiple unknown trailer sections only when explicitly requested", async () => {
    const registry = createRegistry(atariStPlugins);
    const source = stImage("atari-st.degas-compressed");
    const footer = eliteFooter();
    source.components.colorAnimation = footer;
    source.preserved = [
      { id: "degas.trailing", data: Uint8Array.of(1, 2) },
      { id: "degas.trailing", data: Uint8Array.of(3, 4, 5) }
    ];
    const encoded = await registry.encode(source, { preserveUnknown: true });
    expect(encoded.data.subarray(-37)).toEqual(append(footer, Uint8Array.of(1, 2, 3, 4, 5)));
    expect(encoded.warnings).toEqual([]);
  });

  it("rejects unsupported preserved section IDs for DEGAS output", async () => {
    const source = stImage("atari-st.degas-compressed");
    source.preserved = [{ id: "other.data", data: Uint8Array.of(1) }];
    await expect(createRegistry(atariStPlugins).encode(source, { preserveUnknown: true })).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
  });

  it.each([
    ["wrong.pi2", "atari-st.degas", "st-medium", false],
    ["wrong.pc1", "atari-st.degas", "st-low", true],
    ["wrong.pi1", "atari-st.degas-compressed", "st-low", false]
  ] as const)("loads %s by its header and reports the filename mismatch", async (filename, formatId, expectedModeId, expectedCompressed) => {
    const registry = createRegistry(atariStPlugins);
    const source = stImage(formatId);
    const encoded = await registry.encode(source);
    const decoded = await registry.decode(encoded.data, { filename, displayProfile: source.displayProfile });
    expect(decoded.formatId).toBe(formatId);
    expect(decoded.modeId).toBe("st-low");
    const warning = decoded.warnings.find(({ code }) => code === "FILENAME_EXTENSION_MISMATCH");
    expect(warning?.details).toEqual({
      extension: filename.slice(filename.lastIndexOf(".") + 1),
      expectedModeId,
      actualModeId: "st-low",
      expectedCompressed,
      actualCompressed: formatId.endsWith("compressed")
    });
  });

  it("does not warn for an unknown extension", async () => {
    const registry = createRegistry(atariStPlugins);
    const source = stImage("atari-st.degas");
    const decoded = await registry.decode((await registry.encode(source)).data, { filename: "picture.bin", displayProfile: source.displayProfile });
    expect(decoded.warnings).toEqual([]);
  });

  it("rejects a compression family that contradicts an explicitly selected codec", async () => {
    const registry = createRegistry(atariStPlugins);
    const pi = await registry.encode(stImage("atari-st.degas"));
    const pc = await registry.encode(stImage("atari-st.degas-compressed"));
    await expect(registry.decode(pi.data, { formatId: "atari-st.degas-compressed" })).rejects.toMatchObject({ code: "INVALID_FILE" });
    await expect(registry.decode(pc.data, { formatId: "atari-st.degas" })).rejects.toMatchObject({ code: "INVALID_FILE" });
  });

  it("rejects invalid resolution words and truncated PI data", async () => {
    const registry = createRegistry(atariStPlugins);
    const invalidResolution = new Uint8Array(32034);
    invalidResolution[1] = 3;
    await expect(registry.decode(invalidResolution, { formatId: "atari-st.degas" })).rejects.toMatchObject({ code: "INVALID_FILE" });
    await expect(registry.decode(new Uint8Array(33), { formatId: "atari-st.degas" })).rejects.toMatchObject({ code: "INVALID_FILE" });
    await expect(registry.decode(new Uint8Array(32035), { formatId: "atari-st.degas" })).rejects.toMatchObject({ code: "INVALID_FILE" });
  });

  it("rejects incomplete and overflowing compressed data", async () => {
    const registry = createRegistry(atariStPlugins);
    const header = new Uint8Array(34);
    header[0] = 0x80;
    await expect(registry.decode(append(header, Uint8Array.of(0)), { formatId: "atari-st.degas-compressed" })).rejects.toMatchObject({ code: "INVALID_FILE" });

    const overflow = new Uint8Array(34 + 249 * 2 + 128 + 2);
    overflow[0] = 0x80;
    for (let offset = 34; offset < 34 + 249 * 2; offset += 2) {
      overflow[offset] = 0x81;
      overflow[offset + 1] = 0;
    }
    const literal = 34 + 249 * 2;
    overflow[literal] = 126;
    overflow[literal + 128] = 0xff;
    overflow[literal + 129] = 0;
    await expect(registry.decode(overflow, { formatId: "atari-st.degas-compressed" })).rejects.toMatchObject({ code: "INVALID_FILE" });
  });

  it("enforces the decompression limit", async () => {
    const registry = createRegistry(atariStPlugins);
    const encoded = await registry.encode(stImage("atari-st.degas-compressed"));
    await expect(registry.decode(encoded.data, { formatId: "atari-st.degas-compressed", limits: { maxDecompressedBytes: 31999 } })).rejects.toBeInstanceOf(RetroImageError);
    await expect(registry.decode(encoded.data, { formatId: "atari-st.degas-compressed", limits: { maxDecompressedBytes: 31999 } })).rejects.toMatchObject({ code: "LIMIT_EXCEEDED" });
  });

  it("conversion does not invent an Elite footer", async () => {
    const registry = createRegistry(atariStPlugins);
    const source = stImage("atari-st.degas");
    const converted = await registry.convert(source.preview, {
      formatId: "atari-st.degas",
      modeId: "st-low",
      displayProfile: source.displayProfile
    });
    expect(converted.document.components.colorAnimation).toBeUndefined();
    expect((await registry.encode(converted.document)).data).toHaveLength(32034);
  });
});
