// Renders the PWA icon set from the SVG sources in public/icons (run: node scripts/generate-icons.mjs).
import sharp from "sharp";
import { readFile, writeFile } from "node:fs/promises";

const dir = new URL("../public/icons/", import.meta.url);
const icon = await readFile(new URL("icon.svg", dir));
const maskable = await readFile(new URL("maskable.svg", dir));
const render = (svg, size, bg) => {
  let img = sharp(svg, { density: 384 }).resize(size, size);
  if (bg) img = img.flatten({ background: bg });
  return img.png().toBuffer();
};
const out = {
  "icon-192.png": await render(icon, 192),
  "icon-512.png": await render(icon, 512),
  "maskable-192.png": await render(maskable, 192),
  "maskable-512.png": await render(maskable, 512),
  "apple-touch-icon.png": await render(icon, 180, "#0a0d14"),
  "favicon-32.png": await render(icon, 32),
};
for (const [name, buf] of Object.entries(out)) await writeFile(new URL(name, dir), buf);
console.log("icons:", Object.keys(out).join(", "));
