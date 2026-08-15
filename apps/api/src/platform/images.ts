import sharp from 'sharp';

/**
 * Image processing.
 *
 * **EVERY output has its metadata stripped, and that is the point of this file.** A phone
 * photograph carries EXIF, and EXIF carries GPS. The predecessor system published members'
 * names, photographs and residential areas on an open page; publishing the coordinates of
 * the house a photograph was taken in would be the same failure with better precision.
 *
 * `sharp` drops metadata by default — it only preserves it when `withMetadata()` is called.
 * That is a default this system depends on, so `stripped()` states it explicitly rather than
 * relying on a library's choice staying the same across a major version, and there is a test
 * with a real GPS-tagged fixture.
 */

/** 400px: the list thumbnail. The payload budget is a metered Android connection. */
export const THUMB_WIDTH = 400;
/** 1200px: the largest a phone screen can use, and small enough to send over 3G. */
export const DISPLAY_WIDTH = 1200;

export interface ProcessedImage {
  thumb: Buffer;
  display: Buffer;
  width: number;
  height: number;
}

/**
 * A pipeline with no metadata on the way out.
 *
 * `rotate()` with no argument applies the EXIF orientation and then discards it — without
 * it, stripping the metadata turns every portrait photograph on its side, which looks like
 * a bug in the resizer and is actually the orientation tag being thrown away with the rest.
 */
function stripped(input: Buffer): ReturnType<typeof sharp> {
  return sharp(input, { failOn: 'error' }).rotate();
}

export async function processImage(input: Buffer): Promise<ProcessedImage> {
  const metadata = await sharp(input).metadata();

  const [thumb, display] = await Promise.all([
    stripped(input)
      // `inside` and `withoutEnlargement`: never upscale. A 200px logo blown up to 400px is
      // a worse image and a bigger file.
      .resize({ width: THUMB_WIDTH, height: THUMB_WIDTH, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 72 })
      .toBuffer(),
    stripped(input)
      .resize({ width: DISPLAY_WIDTH, withoutEnlargement: true })
      .webp({ quality: 82 })
      .toBuffer(),
  ]);

  return {
    thumb,
    display,
    width: metadata.width ?? 0,
    height: metadata.height ?? 0,
  };
}

/** The TIFF tag that points at the GPS sub-IFD. Its presence is what "has a location" means. */
const GPS_IFD_POINTER = 0x8825;

/**
 * Whether an EXIF block references a GPS sub-IFD.
 *
 * Parsed rather than searched for the string "GPS": EXIF is a binary TIFF structure and the
 * word does not appear in it. A substring check therefore reports "no location" on every
 * photograph ever taken, which is a location test that always passes — the vacuous-harness
 * failure this project has already been bitten by once.
 *
 * Walks IFD0 only. The GPS pointer lives there by specification, and following every
 * sub-IFD would be writing an EXIF reader to answer a yes/no question.
 */
function referencesGpsIfd(exif: Buffer): boolean {
  if (exif.length < 16) return false;

  // sharp hands the block back with its "Exif\0\0" header still attached.
  const start = exif.subarray(0, 6).toString('latin1') === 'Exif\0\0' ? 6 : 0;
  const order = exif.subarray(start, start + 2).toString('latin1');
  if (order !== 'II' && order !== 'MM') return false;

  const little = order === 'II';
  const u16 = (offset: number): number =>
    little ? exif.readUInt16LE(offset) : exif.readUInt16BE(offset);
  const u32 = (offset: number): number =>
    little ? exif.readUInt32LE(offset) : exif.readUInt32BE(offset);

  const ifd0 = start + u32(start + 4);
  if (ifd0 + 2 > exif.length) return false;

  const entries = u16(ifd0);
  for (let index = 0; index < entries; index += 1) {
    const entry = ifd0 + 2 + index * 12;
    if (entry + 2 > exif.length) break;
    if (u16(entry) === GPS_IFD_POINTER) return true;
  }
  return false;
}

/**
 * Whether an image carries location metadata. For the test that proves EXIF is gone, and
 * for anything that later wants to warn an uploader before it strips it.
 */
export async function hasLocationMetadata(input: Buffer): Promise<boolean> {
  const metadata = await sharp(input).metadata();
  if (!metadata.exif) return false;
  return referencesGpsIfd(metadata.exif);
}
