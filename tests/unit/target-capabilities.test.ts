import { describe, expect, it } from "vitest";
import {
  createRegistry,
  isRgbOnComponentGrid,
  medianCut,
  quantizeRgbToComponentGrid,
  resolveRgbComponentPrecision,
  type RgbColor,
  type RgbaImage
} from "../../src/index";
import { atari8Palette, atari8Plugins } from "../../src/atari-8bit";
import { atariStPlugins } from "../../src/atari-st";
import { c64Plugins } from "../../src/c64";
import { netpbmPlugins } from "../../src/netpbm";
import { spectrumPlugins } from "../../src/spectrum";

function image(width: number, height: number, colors: RgbColor[]): RgbaImage {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let pixel = 0; pixel < width * height; pixel += 1) {
    const color = colors[pixel % colors.length]!;
    data.set([color.r, color.g, color.b, color.a ?? 255], pixel * 4);
  }
  return { width, height, data };
}

function uniqueColors(count: number): RgbColor[] {
  return Array.from({ length: count }, (_, index) => ({
    r: index,
    g: (index * 17) & 0xff,
    b: (index * 67) & 0xff
  }));
}

describe("target capability metadata", () => {
  it("describes Atari ST and STE programmable precision and fixed high-resolution monochrome", () => {
    const definition = createRegistry(atariStPlugins).getFormatDefinition("atari-st.degas");
    const low = definition.modes.find(({ id }) => id === "st-low")!;
    const medium = definition.modes.find(({ id }) => id === "st-medium")!;
    const high = definition.modes.find(({ id }) => id === "st-high")!;

    expect(low.palette).toMatchObject({ model: "programmable-indexed", displayColorLimit: 16, storableColorEntries: 16 });
    expect(medium.palette).toMatchObject({ model: "programmable-indexed", displayColorLimit: 4, storableColorEntries: 16 });
    expect(resolveRgbComponentPrecision(low, { hardware: "st", videoStandard: "pal" })).toEqual({ redBits: 3, greenBits: 3, blueBits: 3 });
    expect(resolveRgbComponentPrecision(low, { hardware: "ste", videoStandard: "pal" })).toEqual({ redBits: 4, greenBits: 4, blueBits: 4 });
    expect(high.palette).toMatchObject({
      model: "monochrome",
      displayColorLimit: 2,
      storableColorEntries: 16,
      supportsInverse: true,
      fixedColors: [{ r: 255, g: 255, b: 255 }, { r: 0, g: 0, b: 0 }]
    });
    expect(high.resolutionClass).toBe("high");
    expect(high.interlaceSupport).toBe("none");
    expect(definition.encodingVariants).toEqual([
      { id: "uncompressed", label: "Uncompressed PI", encodeOptions: { compression: "none" } }
    ]);
    expect(createRegistry(atariStPlugins).getFormatDefinition("atari-st.degas-compressed").encodingVariants).toEqual([
      { id: "packbits", label: "DEGAS PackBits PC", encodeOptions: { compression: "packbits" } }
    ]);
  });

  it("describes Spectrum, Atari 8-bit, and direct sampled targets without changing mode ids", () => {
    const spectrum = createRegistry(spectrumPlugins).getFormatDefinition("zx-spectrum.scr").modes[0]!;
    expect(spectrum.id).toBe("spectrum-screen");
    expect(spectrum.palette).toMatchObject({ model: "fixed-indexed", displayColorLimit: 15, storableColorEntries: 16 });
    expect(new Set(spectrum.palette?.fixedColors?.map(({ r, g, b }) => `${r},${g},${b}`))).toHaveLength(15);
    expect(spectrum.cell).toMatchObject({ width: 8, height: 8, maxColors: 2, sharedAttribute: "bright" });

    const atari = createRegistry(atari8Plugins).getFormatDefinition("atari8.raw");
    expect(atari.modes.find(({ id }) => id === "antic-e")?.palette).toMatchObject({
      model: "structured-registers",
      displayColorLimit: 4,
      storableColorEntries: 4,
      registers: [{ id: "color-registers", count: 4, valueModel: "gtia-color-code" }]
    });
    expect(atari.modes.find(({ id }) => id === "gtia-9")?.palette).toMatchObject({
      model: "structured-registers",
      displayColorLimit: 16,
      storableColorEntries: 1,
      registers: [{ id: "hue", count: 1, valueModel: "gtia-hue", derivedDisplayColors: 16 }]
    });
    expect(atari.modes.find(({ id }) => id === "gtia-10")?.palette).toMatchObject({ storableColorEntries: 9 });
    expect(atari.modes.find(({ id }) => id === "gtia-11")?.palette).toMatchObject({
      registers: [{ id: "luminance", count: 1, valueModel: "gtia-luminance", derivedDisplayColors: 16 }]
    });
    expect(atari.modes.find(({ id }) => id === "gtia-9")?.displayVariants?.map(({ videoStandard }) => videoStandard)).toEqual(["pal", "ntsc"]);

    for (const definition of createRegistry(netpbmPlugins).listFormats()) {
      for (const mode of definition.modes) expect(mode.palette?.model).toBe("sampled-direct");
    }
    expect(JSON.parse(JSON.stringify(atari))).toEqual(atari);
  });
});

describe("capability-analysis compatibility", () => {
  it("keeps C64 cell/register analysis authoritative over global source RGB count", () => {
    const source = image(320, 200, [{ r: 0, g: 0, b: 0 }]);
    for (let cell = 0; cell < 17; cell += 1) {
      const color = { r: cell, g: 0, b: 0 };
      const cx = cell % 40;
      const cy = Math.floor(cell / 40);
      for (let y = 0; y < 8; y += 1) for (let x = 0; x < 8; x += 1) {
        source.data.set([color.r, color.g, color.b, 255], ((cy * 8 + y) * source.width + cx * 8 + x) * 4);
      }
    }
    const analysis = createRegistry(c64Plugins).analyze(source, {
      formatId: "c64.art-studio",
      modeId: "hires-bitmap",
      displayProfile: { hardware: "vic-ii", videoStandard: "pal" }
    });
    expect(new Set(analysis.issues.map(({ code }) => code))).not.toContain("TOO_MANY_COLORS");
    expect(new Set(analysis.issues.map(({ code }) => code))).not.toContain("COLOR_OUTSIDE_FIXED_PALETTE");
    expect(analysis.valid).toBe(true);
  });
});

describe("deterministic palette foundations", () => {
  it.each([1, 4, 7, 31, 32])("retains every one of %i unique source colors below the limit", (count) => {
    const colors = uniqueColors(count);
    expect(medianCut(image(count, 1, colors), 32)).toEqual(colors);
  });

  it("limits above the maximum deterministically", () => {
    const source = image(33, 1, uniqueColors(33));
    expect(medianCut(source, 32)).toHaveLength(32);
    expect(medianCut(source, 32)).toEqual(medianCut(source, 32));
  });

  it("checks and quantizes component grids with lower-value tie breaks", () => {
    const rgb333 = { redBits: 3, greenBits: 3, blueBits: 3 };
    expect(isRgbOnComponentGrid({ r: 36, g: 73, b: 109 }, rgb333)).toBe(true);
    expect(isRgbOnComponentGrid({ r: 18, g: 91, b: 237 }, rgb333)).toBe(false);
    expect(quantizeRgbToComponentGrid({ r: 18, g: 91, b: 237 }, rgb333)).toEqual({ r: 0, g: 73, b: 219 });
  });

  it("reports strict programmable-grid violations and auto-quantizes without dithering", async () => {
    const registry = createRegistry(atariStPlugins);
    const target = { formatId: "atari-st.degas", modeId: "st-low", displayProfile: { hardware: "st", videoStandard: "pal" as const } };
    const source = image(320, 200, [{ r: 18, g: 91, b: 237 }]);
    expect(registry.analyze(source, target).issues).toContainEqual(expect.objectContaining({
      code: "COLOR_OUTSIDE_COMPONENT_GRID",
      rule: "palette.rgbComponentPrecision"
    }));

    const converted = await registry.convert(source, target, { dither: "none" });
    expect(converted.document.preview.data.slice(0, 4)).toEqual(Uint8ClampedArray.of(0, 73, 219, 255));
    expect(converted.report.steps).toContainEqual(expect.objectContaining({ operation: "hardware-quantize" }));
  });

  it("reports too many display colors from capability data", () => {
    const registry = createRegistry(atariStPlugins);
    const target = { formatId: "atari-st.degas", modeId: "st-medium", displayProfile: { hardware: "ste", videoStandard: "pal" as const } };
    const source = image(640, 200, [
      { r: 0, g: 0, b: 0 },
      { r: 17, g: 0, b: 0 },
      { r: 34, g: 0, b: 0 },
      { r: 51, g: 0, b: 0 },
      { r: 68, g: 0, b: 0 }
    ]);
    const issue = registry.analyze(source, target).issues.find(({ code }) => code === "TOO_MANY_COLORS");
    expect(issue).toMatchObject({
      code: "TOO_MANY_COLORS",
      rule: "palette.displayColorLimit"
    });
    expect(issue?.details).toMatchObject({ actual: 5, maximum: 4 });
  });
});

describe("Atari 8-bit native register conversion", () => {
  it.each([
    ["gtia-9", 1],
    ["gtia-11", 1],
    ["antic-e", 4],
    ["gtia-10", 9]
  ] as const)("raw-decodes %s with its declared stored register count", async (modeId, count) => {
    const registry = createRegistry(atari8Plugins);
    const mode = registry.getFormatDefinition("atari8.raw").modes.find(({ id }) => id === modeId)!;
    const size = mode.dimensions[0]!;
    const decoded = await registry.decode(new Uint8Array(size.width * size.height * mode.bitsPerPixel / 8), {
      formatId: "atari8.raw",
      modeId,
      displayProfile: { hardware: "antic-gtia", videoStandard: "pal" }
    });
    expect(decoded.components.palette).toHaveLength(count);
  });

  it.each(["antic-2-text", "antic-3-text"] as const)("raw-decodes %s with two stored color registers", async (modeId) => {
    const decoded = await createRegistry(atari8Plugins).decode(new Uint8Array(1024), {
      formatId: "atari8.raw",
      modeId,
      displayProfile: { hardware: "antic-gtia", videoStandard: "ntsc" }
    });
    expect(decoded.components.palette).toHaveLength(2);
  });

  it("preserves the selected GTIA 9 hue in the dedicated GR9 artifact", async () => {
    const registry = createRegistry(atari8Plugins);
    const color = atari8Palette("pal")[0xe8]!;
    const converted = await registry.convert(image(80, 192, [color]), {
      formatId: "atari8.gr9",
      modeId: "gtia-9",
      displayProfile: { hardware: "antic-gtia", videoStandard: "pal" }
    }, { dither: "none" });
    expect(converted.document.components.palette).toEqual(Uint8Array.of(0xe0));
    expect(converted.document.components.stored).toHaveLength(7684);
  });

  it.each([
    ["antic-e", 4],
    ["gtia-10", 9]
  ] as const)("stores exactly the declared %s register capacity", async (modeId, registerCount) => {
    const registry = createRegistry(atari8Plugins);
    const mode = registry.getFormatDefinition("atari8.raw").modes.find(({ id }) => id === modeId)!;
    const size = mode.dimensions[0]!;
    const converted = await registry.convert(image(size.width, size.height, uniqueColors(17)), {
      formatId: "atari8.raw",
      modeId,
      displayProfile: { hardware: "antic-gtia", videoStandard: "pal" }
    }, { dither: "none" });
    expect(converted.document.components.palette).toHaveLength(registerCount);
  });

  it.each([
    ["gtia-9", "same-hue"],
    ["gtia-11", "same-luminance"]
  ] as const)("derives %s colors with %s native code semantics", async (modeId, semantic) => {
    const registry = createRegistry(atari8Plugins);
    const converted = await registry.convert(image(80, 192, uniqueColors(31)), {
      formatId: "atari8.raw",
      modeId,
      displayProfile: { hardware: "antic-gtia", videoStandard: "ntsc" }
    }, { dither: "none" });
    expect(converted.document.components.palette).toHaveLength(1);
    expect(converted.document.kind).toBe("raster");
    if (converted.document.kind !== "raster") throw new Error("Expected raster conversion");
    const used = new Set(converted.document.indices);
    const values = [...used];
    if (semantic === "same-hue") expect(new Set(values.map((value) => value >>> 4))).toHaveLength(1);
    else expect(new Set(values.map((value) => value & 0x0f))).toHaveLength(1);
  });
});
