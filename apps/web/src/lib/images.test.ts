import { describe, expect, it } from 'vitest';
import { compressImage, formatBytes } from './images';

/**
 * The property that matters here is the FALLBACK.
 *
 * The compression itself needs a real canvas and a real image decoder, which means a real
 * browser — the device pass in `docs/17-Device-Pass.md` is what measures whether a 6 MB
 * photograph comes out under 400 KB. What can be proven here, and is worth proving, is that
 * a browser which cannot do any of it still gets its file back: a report must never fail to
 * send because a thumbnail could not be produced.
 */

describe('compressImage', () => {
  it('returns the original untouched where the browser cannot decode an image', async () => {
    // No `createImageBitmap` in this environment, which is exactly the situation on a
    // browser too old or too locked down to do the work.
    const original = new Blob([new Uint8Array([0xff, 0xd8, 0xff])], { type: 'image/jpeg' });

    const result = await compressImage(original);

    expect(result.blob).toBe(original);
    expect(result.isOriginal).toBe(true);
    expect(result.originalBytes).toBe(original.size);
  });

  it('leaves a GIF and an SVG alone', async () => {
    // Re-encoding an animated GIF through a canvas keeps one frame — it would silently throw
    // away the animation. An SVG is not a photograph and rasterising it makes it larger.
    for (const type of ['image/gif', 'image/svg+xml']) {
      const original = new Blob(['x'], { type });
      const result = await compressImage(original);
      expect(result.isOriginal).toBe(true);
      expect(result.blob).toBe(original);
    }
  });

  it('never throws, whatever it is handed', async () => {
    // A member's report must not be lost to a malformed file the camera produced.
    await expect(compressImage(new Blob([]))).resolves.toBeDefined();
    await expect(compressImage(new Blob(['not an image at all']))).resolves.toBeDefined();
  });
});

describe('formatBytes', () => {
  it('reads the way a member would say it', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2 KB');
    expect(formatBytes(400 * 1024)).toBe('400 KB');
    expect(formatBytes(1024 * 1024)).toBe('1.0 MB');
    expect(formatBytes(6_400_000)).toBe('6.1 MB');
  });
});
