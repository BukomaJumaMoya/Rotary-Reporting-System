/**
 * Shrinking a photograph before it leaves the phone.
 *
 * A modern Android camera produces 4–8 MB per shot. The server already resizes and strips
 * metadata (`platform/images.ts`), but that happens AFTER the upload — so without this, a
 * secretary filing one report with four photographs pays for 25 MB of mobile data to send
 * images the district will immediately throw away. NFR-1.4 budgets the WHOLE submission at
 * 500 KB.
 *
 * This is a data-cost measure first and a speed measure second. On a metered connection they
 * are the same thing.
 */

/** NFR-1.3's ceiling is 400px for LIST images; the stored original may be larger. */
const MAX_EDGE = 1600;
const TARGET_BYTES = 400 * 1024;

/** Tried in order. WebP is roughly 30% smaller than JPEG at the same quality. */
const QUALITY_STEPS = [0.82, 0.7, 0.6, 0.5];

export interface CompressedImage {
  blob: Blob;
  /** What the camera produced, so the member can be shown what they saved. */
  originalBytes: number;
  width: number;
  height: number;
  /** True when nothing was done — an unreadable file, or a format we must not re-encode. */
  isOriginal: boolean;
}

/**
 * Whether this browser can actually produce the format.
 *
 * `canvas.toBlob` silently falls back to PNG for a type it does not know, and a PNG of a
 * photograph is LARGER than the JPEG that went in — the exact opposite of the point. So the
 * answer has to be measured rather than assumed from a user-agent string.
 */
let webpSupport: boolean | null = null;

async function supportsWebp(): Promise<boolean> {
  if (webpSupport !== null) return webpSupport;

  try {
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/webp', 0.5),
    );
    webpSupport = blob?.type === 'image/webp';
  } catch {
    webpSupport = false;
  }
  return webpSupport;
}

/**
 * Resizes and re-encodes one photograph.
 *
 * Never throws and never returns nothing: a file it cannot read comes back untouched. The
 * server will still accept it — it sniffs magic bytes and caps the size while reading — and a
 * report that fails to send because a thumbnail could not be produced would be a far worse
 * outcome than one that costs more data than it should.
 */
export async function compressImage(file: Blob): Promise<CompressedImage> {
  const originalBytes = file.size;
  const untouched: CompressedImage = {
    blob: file,
    originalBytes,
    width: 0,
    height: 0,
    isOriginal: true,
  };

  // Re-encoding an animated GIF through a canvas keeps one frame, and an SVG is not a
  // photograph at all. Neither belongs on this path.
  if (file.type === 'image/gif' || file.type === 'image/svg+xml') return untouched;

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return untouched;
  }

  try {
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const width = Math.round(bitmap.width * scale);
    const height = Math.round(bitmap.height * scale);

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;

    const context = canvas.getContext('2d');
    if (!context) return untouched;
    context.drawImage(bitmap, 0, 0, width, height);

    const type = (await supportsWebp()) ? 'image/webp' : 'image/jpeg';

    // Step the quality down until it fits, rather than guessing once. A well-lit group
    // photograph fits at 0.82; a noisy indoor one at 0.5, which still looks fine at 1600px.
    let best: Blob | null = null;
    for (const quality of QUALITY_STEPS) {
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, type, quality),
      );
      if (!blob) break;
      best = blob;
      if (blob.size <= TARGET_BYTES) break;
    }

    // Bigger than what we started with — which happens with an already-optimised image, or a
    // small screenshot. Keep the original; the point is fewer bytes, not our bytes.
    if (!best || best.size >= originalBytes) return untouched;

    return { blob: best, originalBytes, width, height, isOriginal: false };
  } catch {
    return untouched;
  } finally {
    // Frees the decoded bitmap immediately. On a phone holding four 8-megapixel images, the
    // difference between releasing these and waiting for the collector is a tab that
    // survives and one the system kills.
    bitmap.close();
  }
}

/** `1.4 MB`, `320 KB`. For telling a member what something costs. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
