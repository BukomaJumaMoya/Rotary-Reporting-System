import type { Media, RequestContext } from '@dis/contracts';
import { currentQueue, enqueue } from '../../jobs/boss.js';
import { mediaProcessingJob } from '../../jobs/media.job.js';
import { config } from '../../platform/config.js';
import { db } from '../../platform/db.js';
import { generateKey, storage } from '../../platform/storage.js';
import { requireImage, type ParsedUpload } from '../../platform/upload.js';
import * as activities from './service.js';

/**
 * Photographs attached to an activity.
 *
 * The request stores the ORIGINAL and returns. Resizing and metadata stripping happen on the
 * worker, because the upload arrives on a metered Android connection at eleven at night and
 * the sooner the request returns the sooner the secretary knows it worked.
 *
 * Until the worker has run, `thumbKey` is null and the response says `isProcessed: false` —
 * so a client can show a placeholder rather than a broken image, which is what "eventually
 * consistent" has to look like to somebody who does not know that phrase.
 */

interface MediaRow {
  id: string;
  activityId: string;
  mediaType: string;
  storageKey: string;
  thumbKey: string | null;
  caption: string | null;
  sequence: number;
}

async function serialise(row: MediaRow): Promise<Media> {
  const ttl = config.MEDIA_URL_TTL_SECONDS;

  // Minted per response and short-lived. A photograph of a member is not public, and a
  // permanent URL works for whoever ends up holding it.
  const [url, thumbUrl] = await Promise.all([
    storage().signedUrl(row.storageKey, ttl),
    row.thumbKey ? storage().signedUrl(row.thumbKey, ttl) : Promise.resolve(null),
  ]);

  return {
    id: row.id,
    activityId: row.activityId,
    mediaType: row.mediaType,
    caption: row.caption,
    sequence: row.sequence,
    url,
    thumbUrl,
    isProcessed: row.thumbKey !== null,
  };
}

export async function list(ctx: RequestContext, activityId: string): Promise<Media[]> {
  await activities.get(ctx, activityId);

  const rows = await db(ctx).activityMedia.findMany({
    where: { activityId },
    orderBy: { sequence: 'asc' },
  });

  return Promise.all(rows.map((row) => serialise(row)));
}

export async function upload(
  ctx: RequestContext,
  activityId: string,
  parsed: ParsedUpload,
): Promise<Media> {
  await activities.get(ctx, activityId);

  // Magic bytes, not the filename and not the declared Content-Type.
  const { body, type } = requireImage(parsed);

  // The key is GENERATED. A user-supplied filename in a storage key is a path traversal
  // waiting for somebody to try `../`, and the predecessor kept spaces and apostrophes in
  // stored names.
  const key = generateKey('activity-media/original', type.extension);
  await storage().put({ key, body, contentType: type.contentType });

  const existing = await db(ctx).activityMedia.count({ where: { activityId } });

  const created = await db(ctx).activityMedia.create({
    data: {
      activityId,
      mediaType: 'IMAGE',
      storageKey: key,
      caption: parsed.fields['caption']?.slice(0, 240) ?? null,
      sequence: existing,
    },
  });

  if (currentQueue()) {
    await enqueue(mediaProcessingJob, {
      districtId: ctx.districtId,
      rotaryYearId: ctx.rotaryYearId,
      mediaId: created.id,
    });
  } else {
    // No worker in this process. The row exists with its original key, so the photograph is
    // not lost — it simply has no thumbnail yet, and `isProcessed` says so.
    console.warn(`[activity] media ${created.id} stored but no queue is running`);
  }

  return serialise(created);
}

export async function remove(
  ctx: RequestContext,
  activityId: string,
  mediaId: string,
): Promise<void> {
  await activities.get(ctx, activityId);

  const row = await db(ctx).activityMedia.findFirst({ where: { id: mediaId, activityId } });
  if (!row) return;

  await db(ctx).activityMedia.deleteMany({ where: { id: mediaId } });

  // Storage last, and never fatal: an orphan in the bucket is a cost a lifecycle rule can
  // sweep, whereas a row pointing at a deleted object is a broken image forever.
  await Promise.all([
    storage()
      .remove(row.storageKey)
      .catch(() => undefined),
    row.thumbKey
      ? storage()
          .remove(row.thumbKey)
          .catch(() => undefined)
      : Promise.resolve(),
  ]);
}
