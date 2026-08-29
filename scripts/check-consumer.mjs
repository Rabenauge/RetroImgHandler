import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const consumer = await mkdtemp(join(tmpdir(), "retro-img-handler-consumer-"));
try {
  const packed = execFileSync("npm", ["pack", "--silent", "--pack-destination", consumer], { cwd: root, encoding: "utf8" }).trim().split("\n").at(-1);
  if (!packed) throw new Error("npm pack did not return a tarball name");
  await writeFile(join(consumer, "package.json"), JSON.stringify({ name: "consumer-smoke", private: true, type: "module" }));
  execFileSync("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund", join(consumer, packed)], { cwd: consumer, stdio: "pipe" });
  execFileSync(process.execPath, ["--input-type=module", "--eval", "await Promise.all(['retro-img-handler','retro-img-handler/amiga','retro-img-handler/c64','retro-img-handler/spectrum','retro-img-handler/atari-st','retro-img-handler/atari-8bit','retro-img-handler/netpbm','retro-img-handler/png'].map((id) => import(id)))"], { cwd: consumer, stdio: "pipe" });

  await mkdir(join(consumer, "src"));
  await writeFile(join(consumer, "index.html"), '<div id="app"></div><script type="module" src="/src/main.js"></script>');
  await writeFile(join(consumer, "src/main.js"), "import { createRegistry } from 'retro-img-handler'; import { spectrumPlugins } from 'retro-img-handler/spectrum'; document.querySelector('#app').textContent = String(createRegistry(spectrumPlugins).listFormats().length);");
  execFileSync(join(root, "node_modules", ".bin", "vite"), ["build"], { cwd: consumer, stdio: "pipe" });
  const assets = await readdir(join(consumer, "dist", "assets"));
  const javascript = assets.find((name) => name.endsWith(".js"));
  if (!javascript) throw new Error("Consumer Vite build emitted no JavaScript");
  const bundle = await readFile(join(consumer, "dist", "assets", javascript), "utf8");
  if (bundle.includes("Amiga IFF") || bundle.includes("Koala Painter") || bundle.includes("NEOchrome") || bundle.includes("Portable Pixmap")) {
    throw new Error("Spectrum-only consumer unexpectedly bundled another platform codec");
  }
  console.log("Tarball imports and Spectrum-only Vite consumer build passed.");
} finally {
  await rm(consumer, { recursive: true, force: true });
}
