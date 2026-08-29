import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";

test("loads a Spectrum SCR in the demo", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#warnings")).toBeHidden();
  await page.locator("#file").setInputFiles({ name: "screen.scr", mimeType: "application/octet-stream", buffer: Buffer.alloc(6912) });
  await expect(page.locator("#status")).toContainText("zx-spectrum.scr");
  await expect(page.locator("#definition")).toContainText("spectrum-screen");
  await expect(page.locator("#warnings")).toBeVisible();
  await expect(page.locator("#warnings summary")).toContainText("Used the canonical ZX Spectrum 48 PAL profile");
  await expect(page.locator("#preview")).toHaveAttribute("width", "256");
  const download = page.waitForEvent("download");
  await page.locator("#png").click();
  const png = await download;
  expect(png.suggestedFilename()).toBe("screen.scr.png");
  const path = await png.path();
  expect(path).not.toBeNull();
  expect([...((await readFile(path)).subarray(0, 8))]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
});

test("shows decoded warnings with expandable details", async ({ page }) => {
  await page.goto("/");
  const pi1 = Buffer.alloc(32034);
  await page.locator("#file").setInputFiles({ name: "mislabeled.pi2", mimeType: "application/octet-stream", buffer: pi1 });
  await expect(page.locator("#status")).toContainText("atari-st.degas / st-low");
  await expect(page.locator("#status")).toContainText("2 warning(s)");
  const warnings = page.locator("#warnings");
  await expect(warnings).toBeVisible();
  const mismatch = warnings.locator("details").filter({ hasText: "Filename extension .PI2 indicates ST Medium" });
  await expect(mismatch.locator("summary")).toBeVisible();
  await mismatch.locator("summary").click();
  await expect(mismatch.locator(".warning-code")).toContainText("FILENAME_EXTENSION_MISMATCH");
  await expect(mismatch.locator("pre")).toContainText('"expectedModeId": "st-medium"');
  await expect(mismatch.locator("pre")).toContainText('"actualModeId": "st-low"');
});

test("shows preserved DEGAS trailer warnings with expandable details", async ({ page }) => {
  await page.goto("/");
  const pc1 = Buffer.alloc(535);
  pc1[0] = 0x80;
  for (let offset = 34; offset < 534; offset += 2) pc1[offset] = 0x81;
  pc1[534] = 0xff;
  await page.locator("#file").setInputFiles({ name: "trailer.pc1", mimeType: "application/octet-stream", buffer: pc1 });
  await expect(page.locator("#status")).toContainText("atari-st.degas-compressed / st-low");
  await expect(page.locator("#status")).toContainText("2 warning(s)");
  const warning = page.locator("#warnings details").filter({ hasText: "Preserved 1 byte after the DEGAS image" });
  await expect(warning.locator("summary")).toBeVisible();
  await warning.locator("summary").click();
  await expect(warning.locator(".warning-code")).toContainText("UNKNOWN_TRAILING_DATA");
  await expect(warning.locator("pre")).toContainText('"bytes": 1');
  await expect(warning.locator("pre")).toContainText('"eliteFooterSeparated": false');
});

test("decodes in a Web Worker", async ({ page }) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const worker = new Worker("/src/codec.worker.ts", { type: "module" });
    const response = new Promise<Record<string, unknown>>((resolve) => worker.addEventListener("message", (event) => resolve(event.data as Record<string, unknown>), { once: true }));
    worker.postMessage({ filename: "worker.scr", data: new ArrayBuffer(6912) });
    const value = await response;
    worker.terminate();
    return value;
  });
  expect(result).toMatchObject({ ok: true, formatId: "zx-spectrum.scr", width: 256, height: 192 });
});

test("loads and downloads a raw PPM in the demo", async ({ page }) => {
  await page.goto("/");
  const ppm = Buffer.concat([Buffer.from("P6\n2 1\n255\n", "ascii"), Buffer.from([255, 0, 0, 0, 255, 0])]);
  await page.locator("#file").setInputFiles({ name: "primary.ppm", mimeType: "image/x-portable-pixmap", buffer: ppm });

  await expect(page.locator("#status")).toContainText("netpbm.ppm / raw — 2×1");
  await expect(page.locator("#preview")).toHaveAttribute("width", "2");
  expect(await page.locator("#preview").evaluate((canvas: HTMLCanvasElement) => [
    ...canvas.getContext("2d")!.getImageData(0, 0, 2, 1).data
  ])).toEqual([255, 0, 0, 255, 0, 255, 0, 255]);

  const download = page.waitForEvent("download");
  await page.locator("#native").click();
  const native = await download;
  expect(native.suggestedFilename()).toBe("roundtrip-primary.ppm");
  const path = await native.path();
  expect(path).not.toBeNull();
  expect(await readFile(path)).toEqual(ppm);
});

test("decodes PFM in a Web Worker", async ({ page }) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const header = new TextEncoder().encode("Pf\n1 1\n-1\n");
    const data = new Uint8Array(header.length + 4);
    data.set(header);
    new DataView(data.buffer).setFloat32(header.length, 0.25, true);
    const worker = new Worker("/src/codec.worker.ts", { type: "module" });
    const response = new Promise<Record<string, unknown>>((resolve) => worker.addEventListener("message", (event) => resolve(event.data as Record<string, unknown>), { once: true }));
    worker.postMessage({ filename: "worker.pfm", data: data.buffer }, [data.buffer]);
    const value = await response;
    worker.terminate();
    return value;
  });
  expect(result).toMatchObject({ ok: true, formatId: "netpbm.pfm", modeId: "grayscale", width: 1, height: 1 });
});
