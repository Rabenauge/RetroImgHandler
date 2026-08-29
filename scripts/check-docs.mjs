import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";

const entries = (await readdir("src")).filter((file) => file.endsWith(".ts"));
const names = new Set();
for (const entry of entries) {
  const source = await readFile(resolve("src", entry), "utf8");
  for (const match of source.matchAll(/export(?:\s+type)?\s*\{([\s\S]*?)\}\s*from/g)) {
    for (const part of match[1].split(",")) {
      const name = part.trim().split(/\s+as\s+/).at(-1)?.trim();
      if (name) names.add(name);
    }
  }
}
const manual = await readFile("Manual/api-reference.md", "utf8");
const missing = [...names].filter((name) => !manual.includes(`\`${name}\``) && !manual.includes(`\`${name}(`)).sort();
if (missing.length) {
  console.error(`Manual/api-reference.md is missing public exports: ${missing.join(", ")}`);
  process.exitCode = 1;
} else {
  console.log(`Documented ${names.size} public exports.`);
}
