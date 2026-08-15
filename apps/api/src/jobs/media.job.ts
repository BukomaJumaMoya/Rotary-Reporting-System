import { z } from 'zod';
import { db } from '../platform/db.js';
import { processImage } from '../platform/images.js';
import { generateKey, storage } from '../platform/storage.js';
import { defineJob, jobContextSchema } from './define.js';

/**
 * Producing the display and thumbnail variants of an uploaded photograph, and STRIPPING
 * EVERY PIECE OF METADATA on the way.
 *
 * A job rather than inline work for two reasons, and the second matters more. Resizing a
 * 5MB phone photograph takes a second or two of CPU, which on a shared machine is a second
 * or two the API is not answering requests. And the upload happens on a metered Android
 * connection at eleven at night: the sooner the request returns, the sooner the secretary
 * knows the photograph arrived. The variants appear a moment later.
 *
 * **Phone photographs carry GPS.** The predecessor system published members' names,
 * photographs and residential areas to the open internet; publishing the coordinates of the
 * house a photograph was taken in is the same failure with better precision. `processImage`
 * strips it, and there is a test with a real GPS-tagged fixture.
 */
export const mediaProcessingJob = defineJob({
  name: 'media-process',
  schema: jobContextSchema.extend({ mediaId: z.uuid() }),
  describe: (payload) => `process uploaded media ${payload.mediaId}`,
  // Image work is CPU-bound and short. Three attempts covers a transient storage error;
  // more would just occupy the worker.
  retryLimit: 3,
  retryDelaySeconds: 10,
  expireInSeconds: 180,
  handler: async ({ payload, ctx }) => {
    const media = await db(ctx).activityMedia.findFirst({
      where: { id: payload.mediaId },
      select: { id: true, storageKey: true, thumbKey: true },
    });

    // Gone, or belongs to a district this context cannot see. Not an error: the activity
    // may have been deleted between the upload and the job.
    if (!media) return;
    // Already done. A sweep and a queued job can both reach the same row.
    if (media.thumbKey) return;

    const original = await storage().get(media.storageKey);
    const { thumb, display } = await processImage(original);

    const thumbKey = generateKey('activity-media/thumb', 'webp');
    const displayKey = generateKey('activity-media/display', 'webp');

    await Promise.all([
      storage().put({ key: thumbKey, body: thumb, contentType: 'image/webp' }),
      storage().put({ key: displayKey, body: display, contentType: 'image/webp' }),
    ]);

    // The DISPLAY variant becomes the stored key and the original is dropped. Keeping the
    // original would keep the EXIF with it — stripping the copy and retaining the source is
    // the shape of a leak that looks fixed. The original is also the only copy anybody
    // would ever download at full size, which is not a thing this system offers.
    await db(ctx).activityMedia.updateMany({
      where: { id: media.id },
      data: { storageKey: displayKey, thumbKey },
    });

    await storage()
      .remove(media.storageKey)
      .catch((error: unknown) => {
        // An orphan in the bucket is a cost, not a leak, and a lifecycle rule can sweep it.
        console.error('[jobs] could not remove the original upload', error);
      });
  },
});
