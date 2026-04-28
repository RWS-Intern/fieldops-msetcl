/**
 * scripts/generateIcons.ts
 *
 * Generates PWA icon PNGs from an inline SVG using Sharp.
 * Run with: npm run generate:icons
 *
 * Output:
 *   public/icons/icon-192.png      — standard icon (rounded square)
 *   public/icons/icon-512.png      — standard icon (rounded square)
 *   public/icons/icon-maskable.png — maskable icon (full-bleed, safe-zone aware)
 */

import sharp from 'sharp';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir    = path.resolve(__dirname, '../public/icons');

// Ensure output directory exists
fs.mkdirSync(outDir, { recursive: true });

// ─── Standard icon SVG ────────────────────────────────────────────────────────
// Blue rounded square + white "RS" text.

function buildSvg(size: number): Buffer {
  const r   = Math.round(size * 0.18);   // border radius
  const fs_ = Math.round(size * 0.36);   // font size
  const cy  = Math.round(size * 0.565);  // text baseline
  const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" rx="${r}" fill="#0077B6"/>
  <text
    x="50%"
    y="${cy}"
    font-family="Arial,Helvetica,sans-serif"
    font-size="${fs_}"
    font-weight="700"
    fill="white"
    text-anchor="middle"
    dominant-baseline="middle"
    letter-spacing="-1"
  >RS</text>
</svg>`.trim();
  return Buffer.from(svg);
}

// ─── Maskable icon SVG ────────────────────────────────────────────────────────
// Always 512×512. Full-bleed navy background so Android's adaptive-icon
// circle crop never shows a white edge. All important content sits within
// the inner 80% safe zone (≤ 204 px radius from centre).
//
//   Canvas: 512×512
//   Background: #023E6B (navy), no border-radius — full bleed required
//   White circle: radius 160px — well inside the 204 px safe-zone boundary
//   "RS" text: 140px, bold, white, centred at (256, 256)

function buildMaskableSvg(): Buffer {
  const size = 512;
  const cx   = 256;   // circle centre x
  const cy   = 256;   // circle centre y
  const r    = 160;   // circle radius  (safe-zone max ≈ 204 px)
  const fs_  = 140;   // font size
  // text y: slightly below centre to account for font descender
  const ty   = Math.round(cy + fs_ * 0.04);

  const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <!-- Full-bleed navy background (no rx — maskable icons must bleed to edges) -->
  <rect width="${size}" height="${size}" fill="#023E6B"/>
  <!-- White circle within the 80 % safe zone -->
  <circle cx="${cx}" cy="${cy}" r="${r}" fill="white"/>
  <!-- Navy "RS" text centred inside the circle -->
  <text
    x="${cx}"
    y="${ty}"
    font-family="Arial,Helvetica,sans-serif"
    font-size="${fs_}"
    font-weight="700"
    fill="#023E6B"
    text-anchor="middle"
    dominant-baseline="middle"
    letter-spacing="-2"
  >RS</text>
</svg>`.trim();
  return Buffer.from(svg);
}

// ─── Generator ────────────────────────────────────────────────────────────────

async function generate(svgBuffer: Buffer, size: number, name: string) {
  const dest = path.join(outDir, name);
  await sharp(svgBuffer, { density: 300 })
    .resize(size, size)
    .png()
    .toFile(dest);
  console.log(`✓  Generated ${dest}`);
}

(async () => {
  await generate(buildSvg(192), 192, 'icon-192.png');
  await generate(buildSvg(512), 512, 'icon-512.png');
  await generate(buildMaskableSvg(), 512, 'icon-maskable.png');
  console.log('\nPWA icons generated successfully.');
})();
