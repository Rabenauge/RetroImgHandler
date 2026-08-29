import { describe, expect, it } from "vitest";
import { createRegistry, RetroImageError, type RgbaImage, type SampledRasterDocument } from "../../src/index";
import { netpbmPamPlugin, netpbmPbmPlugin, netpbmPfmPlugin, netpbmPgmPlugin, netpbmPlugins, netpbmPpmPlugin } from "../../src/netpbm";

const ascii = (value: string): Uint8Array => new TextEncoder().encode(value);

function rgba(...pixels: Array<[number, number, number, number]>): RgbaImage {
  return { width: pixels.length, height: 1, data: Uint8ClampedArray.from(pixels.flat()) };
}

function append(...parts: Uint8Array[]): Uint8Array {
  const result = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

function floatBytes(values: number[], littleEndian: boolean): Uint8Array {
  const result = new Uint8Array(values.length * 4);
  const view = new DataView(result.buffer);
  values.forEach((value, index) => view.setFloat32(index * 4, value, littleEndian));
  return result;
}

function sampled(document: Awaited<ReturnType<ReturnType<typeof createRegistry>["decode"]>>): SampledRasterDocument {
  expect(document.kind).toBe("sampled-raster");
  return document as SampledRasterDocument;
}

describe("Netpbm codecs", () => {
  it("decodes plain PBM samples with PBM black and white semantics", async () => {
    const source = ascii("P1\n# checker\n3 2\n0 1 0\n1 0 1\n");
    const registry = createRegistry(netpbmPlugins);

    const document = await registry.decode(source, { filename: "checker.pbm" }) as SampledRasterDocument;

    expect(document).toMatchObject({
      kind: "sampled-raster",
      formatId: "netpbm.pbm",
      modeId: "plain",
      width: 3,
      height: 2,
      channelModel: "black-and-white",
      channelCount: 1,
      sampleType: "uint",
      maxSampleValue: 1,
      metadata: { netpbmComments: [" checker"] }
    });
    expect([...document.samples]).toEqual([0, 1, 0, 1, 0, 1]);
    expect([...document.preview.data]).toEqual([
      255, 255, 255, 255,
      0, 0, 0, 255,
      255, 255, 255, 255,
      0, 0, 0, 255,
      255, 255, 255, 255,
      0, 0, 0, 255
    ]);
  });

  it("decodes and encodes raw PBM with row padding and MSB-first pixels", async () => {
    const registry = createRegistry([netpbmPbmPlugin]);
    const document = sampled(await registry.decode(append(ascii("P4\n3 2\n"), Uint8Array.of(0x40, 0xa0))));

    expect([...document.samples]).toEqual([0, 1, 0, 1, 0, 1]);
    expect(document.modeId).toBe("raw");
    expect((await registry.encode(document)).data).toEqual(append(ascii("P4\n3 2\n"), Uint8Array.of(0x40, 0xa0)));

    const plain = await registry.encode(document, {
      target: { formatId: "netpbm.pbm", modeId: "plain", displayProfile: { hardware: "generic" } }
    });
    expect(new TextDecoder().decode(plain.data)).toBe("P1\n3 2\n0 1 0\n1 0 1\n");
  });

  it("decodes PGM comments and maps normative BT.709 samples to an sRGB preview", async () => {
    const registry = createRegistry([netpbmPgmPlugin]);
    const document = sampled(await registry.decode(ascii("P2\n# ramp\n3 1\n255\n0 128 255\n")));

    expect(document).toMatchObject({ formatId: "netpbm.pgm", modeId: "plain", channelModel: "grayscale", maxSampleValue: 255 });
    expect([...document.samples]).toEqual([0, 128, 255]);
    expect([...document.preview.data]).toEqual([0, 0, 0, 255, 140, 140, 140, 255, 255, 255, 255, 255]);
    expect((await registry.encode(document, {
      target: { formatId: "netpbm.pgm", modeId: "raw", displayProfile: { hardware: "generic" } }
    })).data).toEqual(append(ascii("P5\n# ramp\n3 1\n255\n"), Uint8Array.of(0, 128, 255)));
  });

  it("roundtrips big-endian 16-bit raw PGM samples", async () => {
    const registry = createRegistry([netpbmPgmPlugin]);
    const source = append(ascii("P5\n2 1\n65535\n"), Uint8Array.of(0x12, 0x34, 0xff, 0xff));
    const document = sampled(await registry.decode(source));

    expect([...document.samples]).toEqual([0x1234, 0xffff]);
    if (document.sampleType !== "uint") throw new Error("Expected integer PGM samples");
    expect(document.maxSampleValue).toBe(65535);
    expect((await registry.encode(document)).data).toEqual(source);
  });

  it("decodes and encodes plain and raw PPM channel order", async () => {
    const registry = createRegistry([netpbmPpmPlugin]);
    const document = sampled(await registry.decode(ascii("P3\n2 1\n255\n255 0 0 0 255 0\n")));

    expect(document).toMatchObject({ formatId: "netpbm.ppm", modeId: "plain", channelModel: "rgb", channelCount: 3 });
    expect([...document.samples]).toEqual([255, 0, 0, 0, 255, 0]);
    expect([...document.preview.data]).toEqual([255, 0, 0, 255, 0, 255, 0, 255]);
    expect((await registry.encode(document, {
      target: { formatId: "netpbm.ppm", modeId: "raw", displayProfile: { hardware: "generic" } }
    })).data).toEqual(append(ascii("P6\n2 1\n255\n"), Uint8Array.of(255, 0, 0, 0, 255, 0)));
  });

  it("rejects samples above maxval and additional images", async () => {
    const registry = createRegistry(netpbmPlugins);
    await expect(registry.decode(ascii("P2\n1 1\n7\n8\n"))).rejects.toMatchObject({ code: "INVALID_FILE" });
    await expect(registry.decode(append(ascii("P5\n1 1\n255\n"), Uint8Array.of(0), ascii("P5\n1 1\n255\n"), Uint8Array.of(1))))
      .rejects.toMatchObject({ code: "UNSUPPORTED_SEQUENCE" });
    await expect(registry.decode(ascii("P2\n0 1\n255\n"))).rejects.toBeInstanceOf(RetroImageError);
  });

  it.each([
    ["BLACKANDWHITE", 1, 1, [1], "black-and-white", "black-and-white", [255, 255, 255, 255]],
    ["BLACKANDWHITE_ALPHA", 2, 1, [1, 0], "black-and-white-alpha", "black-and-white-alpha", [255, 255, 255, 0]],
    ["GRAYSCALE", 1, 255, [128], "grayscale", "grayscale", [140, 140, 140, 255]],
    ["GRAYSCALE_ALPHA", 2, 255, [128, 64], "grayscale-alpha", "grayscale-alpha", [140, 140, 140, 64]],
    ["RGB", 3, 255, [255, 0, 0], "rgb", "rgb", [255, 0, 0, 255]],
    ["RGB_ALPHA", 4, 255, [255, 0, 0, 128], "rgb-alpha", "rgb-alpha", [255, 0, 0, 128]]
  ] as const)("roundtrips visual PAM tuple type %s", async (tupleType, depth, maxval, values, modeId, channelModel, preview) => {
    const source = append(
      ascii(`P7\nWIDTH 1\nHEIGHT 1\nDEPTH ${depth}\nMAXVAL ${maxval}\nTUPLTYPE ${tupleType}\nENDHDR\n`),
      Uint8Array.from(values)
    );
    const registry = createRegistry([netpbmPamPlugin]);
    const document = sampled(await registry.decode(source));

    expect(document).toMatchObject({ formatId: "netpbm.pam", modeId, channelModel, channelCount: depth, maxSampleValue: maxval });
    expect([...document.samples]).toEqual(values);
    expect([...document.preview.data]).toEqual(preview);
    expect((await registry.encode(document)).data).toEqual(source);
  });

  it("rejects nonvisual or inconsistent PAM headers and does not confuse xv P7 thumbnails with PAM", async () => {
    const registry = createRegistry([netpbmPamPlugin]);
    const unknown = ascii("P7\nWIDTH 1\nHEIGHT 1\nDEPTH 1\nMAXVAL 255\nTUPLTYPE HEIGHTMAP\nENDHDR\n\0");
    const wrongDepth = ascii("P7\nWIDTH 1\nHEIGHT 1\nDEPTH 2\nMAXVAL 255\nTUPLTYPE RGB\nENDHDR\n\0\0");

    await expect(registry.decode(unknown, { formatId: "netpbm.pam" })).rejects.toMatchObject({ code: "UNSUPPORTED_MODE" });
    await expect(registry.decode(wrongDepth, { formatId: "netpbm.pam" })).rejects.toMatchObject({ code: "INVALID_FILE" });
    expect(await registry.detect(ascii("P7 332\n#XV thumbnail\n"))).toEqual([]);
  });

  it("roundtrips little-endian bottom-up RGB PFM while exposing top-down samples", async () => {
    const source = append(
      ascii("PF\n2 2\n-2\n"),
      floatBytes([
        0, 0, 1, 1, 1, 1,
        1, 0, 0, 0, 1, 0
      ], true)
    );
    const registry = createRegistry([netpbmPfmPlugin]);
    const document = sampled(await registry.decode(source));

    expect(document).toMatchObject({
      formatId: "netpbm.pfm",
      modeId: "rgb",
      sampleType: "float32",
      channelModel: "rgb",
      channelCount: 3,
      scaleFactor: 2,
      byteOrder: "little-endian",
      rowOrder: "bottom-up"
    });
    expect([...document.samples]).toEqual([
      1, 0, 0, 0, 1, 0,
      0, 0, 1, 1, 1, 1
    ]);
    expect([...document.preview.data.slice(0, 4)]).toEqual([255, 0, 0, 255]);
    expect((await registry.encode(document)).data).toEqual(source);
  });

  it("supports explicit top-down PFM rows and clip preview mapping", async () => {
    const source = append(ascii("Pf\n2 1\n1\n"), floatBytes([0.25, 1], false));
    const registry = createRegistry([netpbmPfmPlugin]);
    const document = sampled(await registry.decode(source, {
      pfm: { rowOrder: "top-down", toneMapping: "clip", exposure: 0 }
    }));

    expect([...document.samples]).toEqual([0.25, 1]);
    expect([...document.preview.data]).toEqual([137, 137, 137, 255, 255, 255, 255, 255]);
    expect(document).toMatchObject({ byteOrder: "big-endian", rowOrder: "top-down", scaleFactor: 1 });
    expect((await registry.encode(document)).data).toEqual(source);
  });

  it("preserves negative PFM samples with a preview warning and rejects non-finite samples", async () => {
    const registry = createRegistry([netpbmPfmPlugin]);
    const negative = sampled(await registry.decode(append(ascii("Pf\n1 1\n-1\n"), floatBytes([-0.5], true))));
    expect([...negative.samples]).toEqual([-0.5]);
    expect([...negative.preview.data]).toEqual([0, 0, 0, 255]);
    expect(negative.warnings).toContainEqual({
      code: "PFM_NEGATIVE_PREVIEW_CLIPPED",
      message: "Clipped 1 negative PFM sample for the RGBA preview.",
      details: { samples: 1 }
    });

    await expect(registry.decode(append(ascii("Pf\n1 1\n-1\n"), floatBytes([Number.POSITIVE_INFINITY], true))))
      .rejects.toMatchObject({ code: "INVALID_FILE" });
  });

  it("converts RGBA into native sampled PBM, PGM, PPM, PAM, and PFM targets", async () => {
    const registry = createRegistry(netpbmPlugins);
    const source = rgba([255, 255, 255, 255], [0, 255, 0, 255]);
    const target = (formatId: string, modeId: string) => ({ formatId, modeId, displayProfile: { hardware: "generic" } });

    const pbm = sampled((await registry.convert(source, target("netpbm.pbm", "raw"))).document);
    expect([...pbm.samples]).toEqual([0, 0]);

    const pgm = sampled((await registry.convert(source, target("netpbm.pgm", "raw"), { maxSampleValue: 255 })).document);
    expect([...pgm.samples]).toEqual([255, 216]);

    const ppm = sampled((await registry.convert(source, target("netpbm.ppm", "raw"), { maxSampleValue: 1023 })).document);
    expect([...ppm.samples]).toEqual([1023, 1023, 1023, 0, 1023, 0]);

    const pam = sampled((await registry.convert(rgba([255, 0, 0, 128]), target("netpbm.pam", "rgb-alpha"))).document);
    expect([...pam.samples]).toEqual([255, 0, 0, 128]);

    const pfm = sampled((await registry.convert(rgba([255, 0, 0, 255]), target("netpbm.pfm", "rgb"))).document);
    expect([...pfm.samples]).toEqual([1, 0, 0]);
    expect(pfm).toMatchObject({ sampleType: "float32", scaleFactor: 1, byteOrder: "little-endian", rowOrder: "bottom-up" });
  });

  it("requires explicit compositing for targets without alpha and rejects inapplicable options", async () => {
    const registry = createRegistry(netpbmPlugins);
    const target = { formatId: "netpbm.ppm", modeId: "raw", displayProfile: { hardware: "generic" } };
    const transparent = rgba([255, 0, 0, 0]);

    await expect(registry.convert(transparent, target)).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    const composed = sampled((await registry.convert(transparent, target, { background: { r: 255, g: 255, b: 255 } })).document);
    expect([...composed.samples]).toEqual([255, 255, 255]);
    await expect(registry.convert(rgba([255, 0, 0, 255]), target, { dither: "bayer2" })).rejects.toMatchObject({ code: "INVALID_OPTION" });
    await expect(registry.convert(rgba([255, 0, 0, 255]), {
      formatId: "netpbm.pfm", modeId: "rgb", displayProfile: { hardware: "generic" }
    }, { maxSampleValue: 255 })).rejects.toMatchObject({ code: "INVALID_OPTION" });
  });

  it("roundtrips 16-bit PPM and PAM samples", async () => {
    const ppmSource = append(ascii("P6\n1 1\n1023\n"), Uint8Array.of(0x03, 0xff, 0x02, 0x00, 0x00, 0x01));
    const ppmRegistry = createRegistry([netpbmPpmPlugin]);
    const ppm = sampled(await ppmRegistry.decode(ppmSource));
    expect([...ppm.samples]).toEqual([1023, 512, 1]);
    expect((await ppmRegistry.encode(ppm)).data).toEqual(ppmSource);

    const pamSource = append(
      ascii("P7\nWIDTH 1\nHEIGHT 1\nDEPTH 2\nMAXVAL 1023\nTUPLTYPE GRAYSCALE_ALPHA\nENDHDR\n"),
      Uint8Array.of(0x02, 0x00, 0x01, 0x00)
    );
    const pamRegistry = createRegistry([netpbmPamPlugin]);
    const pam = sampled(await pamRegistry.decode(pamSource));
    expect([...pam.samples]).toEqual([512, 256]);
    expect(pam.preview.data[3]).toBe(64);
    expect((await pamRegistry.encode(pam)).data).toEqual(pamSource);
  });

  it("wraps plain sample output at 70 characters or fewer", async () => {
    const registry = createRegistry([netpbmPgmPlugin]);
    const source = append(ascii("P5\n20 1\n65535\n"), new Uint8Array(40).fill(0xff));
    const document = sampled(await registry.decode(source));
    const encoded = await registry.encode(document, {
      target: { formatId: "netpbm.pgm", modeId: "plain", displayProfile: { hardware: "generic" } }
    });
    const lines = new TextDecoder().decode(encoded.data).trimEnd().split("\n");
    expect(lines.slice(3).every((line) => line.length <= 70)).toBe(true);
    expect(lines.slice(3).join(" ").split(/\s+/)).toHaveLength(20);
  });

  it.each(["none", "bayer2", "bayer4", "floyd-steinberg"] as const)("supports %s bilevel conversion", async (dither) => {
    const registry = createRegistry([netpbmPbmPlugin]);
    const source = rgba(...Array.from({ length: 16 }, (_, index) => {
      const value = index * 17;
      return [value, value, value, 255] as [number, number, number, number];
    }));
    const converted = sampled((await registry.convert(source, {
      formatId: "netpbm.pbm", modeId: "raw", displayProfile: { hardware: "generic" }
    }, { dither })).document);
    expect([...converted.samples].every((sample) => sample === 0 || sample === 1)).toBe(true);
    expect((await registry.encode(converted)).data.length).toBeGreaterThan(0);
  });

  it("enforces resource limits and encoder sample ranges", async () => {
    const registry = createRegistry([netpbmPgmPlugin]);
    await expect(registry.decode(ascii("P2\n3 2\n255\n0 0 0 0 0 0\n"), { limits: { maxPixels: 5 } }))
      .rejects.toMatchObject({ code: "LIMIT_EXCEEDED" });
    const document = sampled(await registry.decode(ascii("P2\n1 1\n255\n1\n")));
    if (document.sampleType !== "uint") throw new Error("Expected integer PGM samples");
    document.samples[0] = 256;
    await expect(registry.encode(document)).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
  });

  it("applies explicit PFM encode row, byte-order, and scale overrides", async () => {
    const registry = createRegistry([netpbmPfmPlugin]);
    const decoded = sampled(await registry.decode(append(ascii("Pf\n1 2\n-1\n"), floatBytes([0.75, 0.25], true))));
    const encoded = await registry.encode(decoded, { pfm: { rowOrder: "top-down", byteOrder: "big-endian", scaleFactor: 2 } });
    expect(encoded.data).toEqual(append(ascii("Pf\n1 2\n2\n"), floatBytes([0.25, 0.75], false)));
  });

  it("publishes all five format definitions", () => {
    expect(createRegistry(netpbmPlugins).listFormats().map(({ id }) => id)).toEqual([
      "netpbm.pbm", "netpbm.pgm", "netpbm.ppm", "netpbm.pam", "netpbm.pfm"
    ]);
  });

  it("accepts a raw PNM comment before the raster separator without consuming a hash-valued sample", async () => {
    const source = append(ascii("P5\n1 1\n255 # final header comment\n"), Uint8Array.of(0x23));
    const document = sampled(await createRegistry([netpbmPgmPlugin]).decode(source));
    expect([...document.samples]).toEqual([0x23]);
    expect(document.metadata.netpbmComments).toEqual([" final header comment"]);
  });

  it("accepts non-newline PFM header separators", async () => {
    const source = append(ascii("Pf 1 1 -1 "), floatBytes([0.25], true));
    const document = sampled(await createRegistry([netpbmPfmPlugin]).decode(source));
    expect([...document.samples]).toEqual([0.25]);
  });

  it("reports transparent RGBA as invalid for PAM and PFM targets without alpha", () => {
    const registry = createRegistry(netpbmPlugins);
    const transparent = rgba([255, 0, 0, 128]);
    const target = (formatId: string, modeId: string) => ({ formatId, modeId, displayProfile: { hardware: "generic" } });

    expect(registry.analyze(transparent, target("netpbm.pam", "rgb")).issues).toContainEqual(expect.objectContaining({ code: "ALPHA_UNSUPPORTED" }));
    expect(registry.analyze(transparent, target("netpbm.pfm", "rgb")).issues).toContainEqual(expect.objectContaining({ code: "ALPHA_UNSUPPORTED" }));
    expect(registry.analyze(transparent, target("netpbm.pam", "rgb-alpha")).valid).toBe(true);
  });
});
