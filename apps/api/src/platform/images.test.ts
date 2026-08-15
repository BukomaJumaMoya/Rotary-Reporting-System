import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { DISPLAY_WIDTH, THUMB_WIDTH, hasLocationMetadata, processImage } from './images.js';
import { MAX_UPLOAD_BYTES, requireImage, sniffImage } from './upload.js';

/**
 * The media pipeline's two jobs: refuse anything that is not an image, and make sure nothing
 * that IS one carries a location out the other side.
 *
 * The GPS test is the one that matters. Phone photographs carry EXIF and EXIF carries
 * coordinates; the predecessor system published members' names, photographs and residential
 * areas to the open internet, and publishing the house a photograph was taken in is the same
 * failure with better precision.
 */

/**
 * A photograph with real GPS tags in its EXIF, built rather than checked in as a binary.
 *
 * **The GPS block is `IFD3`, not a key called `GPS`.** sharp passes `withExif` straight to
 * libvips, which numbers its EXIF directories — ifd0 is the image, ifd1 the thumbnail, ifd2
 * the EXIF sub-IFD and ifd3 the GPS one. A fixture written with a `GPS` key produces a JPEG
 * with no location in it at all, which would make this whole test pass while proving
 * nothing. Verified by reading the tags back: only `IFD3` yields 0x8825.
 */
async function gpsTaggedJpeg(): Promise<Buffer> {
  return sharp({
    create: { width: 1600, height: 1200, channels: 3, background: '#c8102e' },
  })
    .withExif({
      IFD0: { Make: 'DIS-TEST', Model: 'Fixture' },
      IFD3: {
        // Kampala. If this survives the pipeline, so does every member's home address.
        GPSLatitudeRef: 'N',
        GPSLatitude: '0/1 19/1 0/1',
        GPSLongitudeRef: 'E',
        GPSLongitude: '32/1 34/1 0/1',
      },
    })
    .jpeg()
    .toBuffer();
}

describe('image processing', () => {
  it('STRIPS the GPS coordinates a phone photograph carries', async () => {
    const original = await gpsTaggedJpeg();

    // The fixture must actually carry what the test claims, or this proves nothing — the
    // exact failure mode a "passes vacuously" harness has.
    expect(await hasLocationMetadata(original)).toBe(true);

    const processed = await processImage(original);

    expect(await hasLocationMetadata(processed.display)).toBe(false);
    expect(await hasLocationMetadata(processed.thumb)).toBe(false);

    // And nothing else survived either: sharp drops metadata unless asked to keep it, and
    // this asserts that default rather than trusting it across a major version.
    const displayMeta = await sharp(processed.display).metadata();
    expect(displayMeta.exif).toBeUndefined();
  });

  it('produces a WebP thumbnail and display variant at the right widths', async () => {
    const processed = await processImage(await gpsTaggedJpeg());

    const [thumb, display] = await Promise.all([
      sharp(processed.thumb).metadata(),
      sharp(processed.display).metadata(),
    ]);

    expect(thumb.format).toBe('webp');
    expect(thumb.width).toBeLessThanOrEqual(THUMB_WIDTH);
    expect(display.format).toBe('webp');
    expect(display.width).toBe(DISPLAY_WIDTH);

    // The payload budget is a metered Android connection. A thumbnail bigger than the
    // display image would mean the resize did nothing.
    expect(processed.thumb.byteLength).toBeLessThan(processed.display.byteLength);
  });

  it('never upscales a small image', async () => {
    const small = await sharp({
      create: { width: 200, height: 150, channels: 3, background: '#005daa' },
    })
      .png()
      .toBuffer();

    const processed = await processImage(small);
    const display = await sharp(processed.display).metadata();

    // 200px blown up to 1200 is a worse image AND a bigger file.
    expect(display.width).toBe(200);
  });
});

describe('upload sniffing', () => {
  it('recognises an image by its BYTES, not its name', async () => {
    const png = await sharp({
      create: { width: 4, height: 4, channels: 3, background: '#000' },
    })
      .png()
      .toBuffer();
    const jpeg = await sharp(png).jpeg().toBuffer();
    const webp = await sharp(png).webp().toBuffer();

    expect(sniffImage(png)?.contentType).toBe('image/png');
    expect(sniffImage(jpeg)?.contentType).toBe('image/jpeg');
    expect(sniffImage(webp)?.contentType).toBe('image/webp');
  });

  it('refuses a file that is not an image whatever it is called', () => {
    // An HTML document named photo.jpg. Stored and served back from a domain that holds a
    // session cookie, this is stored XSS — which is why the extension is not consulted.
    const html = Buffer.from('<html><script>alert(1)</script></html>', 'utf8');
    expect(sniffImage(html)).toBeUndefined();

    expect(() =>
      requireImage({
        file: { body: html, reportedName: 'photo.jpg', size: html.byteLength },
        fields: {},
      }),
    ).toThrowError(expect.objectContaining({ code: 'UNSUPPORTED_MEDIA_TYPE' }));
  });

  it('refuses an empty upload', () => {
    expect(() => requireImage({ file: undefined, fields: {} })).toThrowError(
      expect.objectContaining({ code: 'VALIDATION_ERROR' }),
    );
  });

  it('caps uploads at 10MB', () => {
    // A modern phone photograph is 2–5MB; twice that is generous and still bounded.
    expect(MAX_UPLOAD_BYTES).toBe(10 * 1024 * 1024);
  });
});
