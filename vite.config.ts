import { resolve } from "node:path";
import { defineConfig } from "vite";
import dts from "vite-plugin-dts";

export default defineConfig({
  build: {
    target: "es2022",
    sourcemap: true,
    lib: {
      entry: {
        index: resolve(import.meta.dirname, "src/index.ts"),
        amiga: resolve(import.meta.dirname, "src/amiga.ts"),
        c64: resolve(import.meta.dirname, "src/c64.ts"),
        spectrum: resolve(import.meta.dirname, "src/spectrum.ts"),
        "atari-st": resolve(import.meta.dirname, "src/atari-st.ts"),
        "atari-8bit": resolve(import.meta.dirname, "src/atari-8bit.ts"),
        netpbm: resolve(import.meta.dirname, "src/netpbm.ts"),
        png: resolve(import.meta.dirname, "src/png.ts")
      },
      formats: ["es"]
    },
    rollupOptions: {
      output: {
        entryFileNames: "[name].js",
        chunkFileNames: "chunks/[name]-[hash].js"
      }
    }
  },
  plugins: [dts({
    tsconfigPath: "tsconfig.json",
    entryRoot: "src",
    include: ["src"],
    exclude: ["tests", "demo"],
    rollupTypes: false
  })]
});
