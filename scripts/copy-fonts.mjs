// Copies the bundled OFL fonts from @fontsource into public/fonts.
// Run after upgrading the font packages: node scripts/copy-fonts.mjs
import fs from "node:fs";
import path from "node:path";

const FONTS = [
  ["atkinson-hyperlegible", "atkinson-hyperlegible-latin-{w}-normal.woff", "sans"],
  ["lora", "lora-latin-{w}-normal.woff", "serif"],
  ["nunito", "nunito-latin-{w}-normal.woff", "rounded"],
];
const out = path.resolve("public/fonts");
fs.mkdirSync(out, { recursive: true });
for (const [pkg, pattern, key] of FONTS) {
  const dir = path.resolve("node_modules/@fontsource", pkg);
  for (const w of [400, 700]) {
    fs.copyFileSync(path.join(dir, "files", pattern.replace("{w}", w)), path.join(out, `${key}-${w}.woff`));
  }
  fs.copyFileSync(path.join(dir, "LICENSE"), path.join(out, `LICENSE-${pkg}.txt`));
}
console.log("Fonts copied to", out);
