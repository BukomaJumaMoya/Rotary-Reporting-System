/**
 * Generates the PWA icon set from one SVG.
 *
 *   node scripts/generate-icons.mjs
 *
 * Checked in as a SCRIPT rather than as eight hand-made PNGs so the mark can be changed in
 * one place. The district will want its own artwork eventually; when it does, replace the
 * SVG below and re-run this.
 *
 * **Rotaract palette, and never the Rotary wheel.** Rotaract has its own mark and the wheel
 * is not it — CLAUDE.md says so, and a district system wearing the wrong badge is the kind
 * of thing somebody notices in a photograph of a projector screen.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const HERE = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(HERE, '..', 'public');

/** --color-cranberry-500 from src/index.css. One definition of the brand, not two. */
const CRANBERRY = '#d41367';

/**
 * `padding` is the maskable safe zone.
 *
 * Android crops a maskable icon to whatever shape the launcher uses — circle, squircle,
 * teardrop — and only the middle 80% is guaranteed to survive. An icon drawn edge to edge
 * comes out with its letter clipped on exactly the devices this system is for.
 */
function markSvg({ size, background, padding }) {
  const inset = size * padding;
  const box = size - inset * 2;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" fill="${background}"/>
  <g transform="translate(${inset} ${inset})">
    <text x="${box / 2}" y="${box / 2}"
          font-family="Segoe UI, Helvetica, Arial, sans-serif"
          font-size="${box * 0.68}" font-weight="700"
          fill="#ffffff" text-anchor="middle" dominant-baseline="central">R</text>
  </g>
</svg>`;
}

const ICONS = [
  // Transparent-cornered, for browsers that draw their own shape.
  { file: 'icon-192.png', size: 192, background: CRANBERRY, padding: 0.12 },
  { file: 'icon-512.png', size: 512, background: CRANBERRY, padding: 0.12 },
  // Maskable: full-bleed background, letter well inside the safe zone.
  { file: 'icon-maskable-192.png', size: 192, background: CRANBERRY, padding: 0.2 },
  { file: 'icon-maskable-512.png', size: 512, background: CRANBERRY, padding: 0.2 },
  // iOS ignores the manifest for the home-screen icon and reads this instead.
  { file: 'apple-touch-icon.png', size: 180, background: CRANBERRY, padding: 0.14 },
  { file: 'favicon-32.png', size: 32, background: CRANBERRY, padding: 0.08 },
];

await mkdir(PUBLIC, { recursive: true });

for (const icon of ICONS) {
  const svg = markSvg(icon);
  await sharp(Buffer.from(svg)).png().toFile(join(PUBLIC, icon.file));
  console.log(`  ${icon.file}  ${icon.size}×${icon.size}`);
}

// The SVG itself, for anything that prefers one — and as the source of truth for the mark.
await writeFile(
  join(PUBLIC, 'icon.svg'),
  markSvg({ size: 512, background: CRANBERRY, padding: 0.12 }),
);
console.log('  icon.svg');
