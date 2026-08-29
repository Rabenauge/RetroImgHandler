import { createRegistry, type CodecWarning, type RetroImageDocument } from "../../src/index";
import { amigaPlugins } from "../../src/amiga";
import { atari8Plugins } from "../../src/atari-8bit";
import { atariStPlugins } from "../../src/atari-st";
import { c64Plugins } from "../../src/c64";
import { exportPng } from "../../src/png";
import { netpbmPlugins } from "../../src/netpbm";
import { spectrumPlugins } from "../../src/spectrum";

const registry = createRegistry([...amigaPlugins, ...c64Plugins, ...spectrumPlugins, ...atariStPlugins, ...atari8Plugins, ...netpbmPlugins]);
const fileInput = document.querySelector<HTMLInputElement>("#file")!;
const status = document.querySelector<HTMLElement>("#status")!;
const warningsPanel = document.querySelector<HTMLElement>("#warnings")!;
const warningList = document.querySelector<HTMLElement>("#warning-list")!;
const detection = document.querySelector<HTMLElement>("#detection")!;
const definition = document.querySelector<HTMLElement>("#definition")!;
const canvas = document.querySelector<HTMLCanvasElement>("#preview")!;
const nativeButton = document.querySelector<HTMLButtonElement>("#native")!;
const pngButton = document.querySelector<HTMLButtonElement>("#png")!;
let current: RetroImageDocument | undefined;
let currentFile: File | undefined;

function download(data: Uint8Array, filename: string, type: string): void {
  const bytes = data.slice().buffer;
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function draw(image: RetroImageDocument): void {
  canvas.width = image.preview.width;
  canvas.height = image.preview.height;
  canvas.style.aspectRatio = `${image.preview.width * image.pixelAspect.numerator} / ${image.preview.height * image.pixelAspect.denominator}`;
  canvas.getContext("2d")!.putImageData(new ImageData(image.preview.data.slice(), image.preview.width, image.preview.height), 0, 0);
}

function renderWarnings(warnings: CodecWarning[]): void {
  warningList.replaceChildren();
  warningsPanel.hidden = warnings.length === 0;
  for (const warning of warnings) {
    const item = document.createElement("details");
    const summary = document.createElement("summary");
    summary.textContent = warning.message;
    const code = document.createElement("p");
    code.className = "warning-code";
    code.textContent = `Code: ${warning.code}`;
    item.append(summary, code);
    if (warning.details !== undefined) {
      const details = document.createElement("pre");
      details.textContent = JSON.stringify(warning.details, null, 2);
      item.append(details);
    }
    warningList.append(item);
  }
}

async function handleFile(): Promise<void> {
  const file = fileInput.files?.[0];
  if (!file) return;
  currentFile = file;
  nativeButton.disabled = true;
  pngButton.disabled = true;
  renderWarnings([]);
  status.textContent = "Detecting and decoding…";
  try {
    const candidates = await registry.detect(file, { filename: file.name });
    detection.textContent = JSON.stringify(candidates, null, 2);
    current = await registry.decode(file, { filename: file.name });
    definition.textContent = JSON.stringify(registry.getFormatDefinition(current.formatId), null, 2);
    draw(current);
    renderWarnings(current.warnings);
    status.textContent = `${current.formatId} / ${current.modeId} — ${current.width}×${current.height}; ${current.warnings.length} warning(s)`;
    nativeButton.disabled = false;
    pngButton.disabled = false;
  } catch (error) {
    current = undefined;
    renderWarnings([]);
    status.textContent = error instanceof Error ? error.message : String(error);
  }
}
fileInput.addEventListener("change", () => { void handleFile(); });

async function downloadNative(): Promise<void> {
  if (!current || !currentFile) return;
  const encoded = await registry.encode(current);
  download(encoded.data, `roundtrip-${currentFile.name}`, "application/octet-stream");
}
nativeButton.addEventListener("click", () => { void downloadNative(); });

async function downloadPng(): Promise<void> {
  if (!current || !currentFile) return;
  download(await exportPng(current, { aspectMode: "square" }), `${currentFile.name}.png`, "image/png");
}
pngButton.addEventListener("click", () => { void downloadPng(); });
