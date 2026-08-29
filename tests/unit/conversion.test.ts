import { describe, expect, it } from "vitest";
import { createRegistry, type CodecTarget, type RgbaImage } from "../../src/index";
import { amigaPlugins } from "../../src/amiga";
import { atari8Plugins } from "../../src/atari-8bit";
import { atariStPlugins } from "../../src/atari-st";
import { c64Plugins } from "../../src/c64";
import { spectrumPlugins } from "../../src/spectrum";

function gradient(width: number, height: number): RgbaImage {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    const offset = (y * width + x) * 4;
    data.set([x * 255 / Math.max(1, width - 1), y * 255 / Math.max(1, height - 1), (x + y) & 255, 255], offset);
  }
  return { width, height, data };
}

async function convertAndEncode(plugins: Parameters<typeof createRegistry>[0], image: RgbaImage, target: CodecTarget): Promise<void> {
  const registry = createRegistry(plugins);
  const converted = await registry.convert(image, target, { dither: "bayer2" });
  expect(converted.report.steps.length).toBeGreaterThan(1);
  expect(registry.analyze(converted.document, target).valid).toBe(true);
  expect((await registry.encode(converted.document)).data.length).toBeGreaterThan(0);
}

describe("target conversions", () => {
  it("converts to Spectrum attribute cells", async () => {
    await convertAndEncode(spectrumPlugins, gradient(256, 192), { formatId: "zx-spectrum.scr", modeId: "spectrum-screen", displayProfile: { hardware: "ula-48", videoStandard: "pal" } });
  });

  it("converts to C64 multicolor cells", async () => {
    await convertAndEncode(c64Plugins, gradient(160, 200), { formatId: "c64.koala", modeId: "multicolor-bitmap", displayProfile: { hardware: "vic-ii", videoStandard: "pal" } });
  });

  it("converts to Amiga HAM6 commands", async () => {
    await convertAndEncode(amigaPlugins, gradient(64, 32), { formatId: "amiga.ilbm", modeId: "ocs-ham6", displayProfile: { hardware: "ocs", videoStandard: "pal" } });
  });

  it("converts to Atari ST planes", async () => {
    await convertAndEncode(atariStPlugins, gradient(320, 200), { formatId: "atari-st.degas", modeId: "st-low", displayProfile: { hardware: "ste", videoStandard: "pal" } });
  });

  it("converts to Atari 8-bit MIC color codes", async () => {
    await convertAndEncode(atari8Plugins, gradient(160, 192), { formatId: "atari8.mic", modeId: "antic-e", displayProfile: { hardware: "antic-gtia", videoStandard: "pal" } });
  });
});
