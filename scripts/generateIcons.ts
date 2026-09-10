/**
 * scripts/generateIcons.ts
 *
 * Generates the PWA icon set and favicon from the Rite Water brand mark.
 * Run with: npm run generate:icons
 *
 * Source: public/rite-water-logo.png — 420×512, transparent. Because it is
 * NOT square it is padded onto a square canvas with `fit: 'contain'`, never
 * stretched or cropped: the logo's longest side is scaled to a percentage of
 * the canvas and the remainder is margin. Margins are equal on each axis; the
 * horizontal margin is naturally larger than the vertical one, which is what
 * preserving a portrait aspect ratio on a square canvas means.
 *
 * Output (public/icons/):
 *   icon-192.png       — standard, logo at 80% of canvas, transparent
 *   icon-512.png       — standard, logo at 80% of canvas, transparent
 *   icon-maskable.png  — maskable, logo at 60% of canvas, WHITE background
 *   favicon-32.png     — browser tab, logo at 90% of canvas, transparent
 *
 * Why the maskable icon has an opaque white background while the others are
 * transparent: Android crops a maskable icon to a circle/squircle and fills
 * whatever it crops against, so a transparent maskable icon renders on an
 * undefined backdrop — and this logo's "rite" wordmark and Devanagari subtext
 * are dark charcoal, which vanishes on a dark one. White is the background the
 * mark is designed for (it is used on white in the header and login screen).
 * The 60% coverage keeps every part of the logo inside the ~80% safe zone that
 * the crop can reach.
 */

import sharp from 'sharp';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC       = path.resolve(__dirname, '../public/rite-water-logo.png');
const outDir    = path.resolve(__dirname, '../public/icons');

fs.mkdirSync(outDir, { recursive: true });

const TRANSPARENT = { r: 0, g: 0, b: 0, alpha: 0 };
const WHITE       = { r: 255, g: 255, b: 255, alpha: 1 };

/**
 * @param size      square canvas edge, px
 * @param coverage  fraction of the canvas the logo's longest side occupies
 * @param background canvas fill behind the logo
 */
async function generate(
  name: string,
  size: number,
  coverage: number,
  background: { r: number; g: number; b: number; alpha: number },
) {
  const inner = Math.round(size * coverage);

  // contain → the logo fits inside inner×inner with its aspect ratio intact.
  const logo = await sharp(SRC)
    .resize(inner, inner, { fit: 'contain', background: TRANSPARENT })
    .toBuffer();

  const dest = path.join(outDir, name);
  await sharp({ create: { width: size, height: size, channels: 4, background } })
    .composite([{ input: logo, gravity: 'centre' }])
    .png()
    .toFile(dest);

  const pct = Math.round(coverage * 100);
  console.log(`✓  ${name.padEnd(20)} ${size}×${size}  logo ${pct}%  ${background.alpha === 0 ? 'transparent' : 'white'}`);
}

(async () => {
  await generate('icon-192.png',      192, 0.80, TRANSPARENT);
  await generate('icon-512.png',      512, 0.80, TRANSPARENT);
  await generate('icon-maskable.png', 512, 0.60, WHITE);
  await generate('favicon-32.png',     32, 0.90, TRANSPARENT);
  console.log('\nPWA icons generated from public/rite-water-logo.png');
})();
