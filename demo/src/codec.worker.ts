import { createRegistry } from "../../src/index";
import { amigaPlugins } from "../../src/amiga";
import { atari8Plugins } from "../../src/atari-8bit";
import { atariStPlugins } from "../../src/atari-st";
import { c64Plugins } from "../../src/c64";
import { netpbmPlugins } from "../../src/netpbm";
import { spectrumPlugins } from "../../src/spectrum";

const registry = createRegistry([...amigaPlugins, ...c64Plugins, ...spectrumPlugins, ...atariStPlugins, ...atari8Plugins, ...netpbmPlugins]);
const workerScope = globalThis as unknown as {
  addEventListener(type: "message", listener: (event: MessageEvent<{ data: ArrayBuffer; filename: string }>) => void): void;
  postMessage(message: unknown, transfer?: Transferable[]): void;
};

async function handleMessage(event: MessageEvent<{ data: ArrayBuffer; filename: string }>): Promise<void> {
  try {
    const image = await registry.decode(event.data.data, { filename: event.data.filename });
    workerScope.postMessage({ ok: true, formatId: image.formatId, modeId: image.modeId, width: image.width, height: image.height, preview: image.preview.data.buffer }, [image.preview.data.buffer as ArrayBuffer]);
  } catch (error) {
    workerScope.postMessage({ ok: false, error: error instanceof Error ? error.message : String(error) });
  }
}
workerScope.addEventListener("message", (event) => { void handleMessage(event); });
