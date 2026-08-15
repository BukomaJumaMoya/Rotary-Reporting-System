/**
 * Clearing what the service worker kept.
 *
 * **This is a data-protection requirement, not housekeeping.** A shared phone is the normal
 * case in a Rotaract club — one handset, three officers, a treasurer who borrows it to check
 * a figure. A cache that survives sign-out means the next person to open the app sees the
 * previous person's district: their members, their contact details, their club's activity.
 * That is the predecessor's failure in a new form, and it is the reason this runs on logout
 * rather than on a timer.
 *
 * Everything goes, not just the API caches. A precached shell is harmless on its own, but a
 * partial clear is a rule somebody has to keep correct as caches are added, and the shell is
 * re-fetched in one request on the next load.
 */

/** Removes every Cache Storage entry this origin holds. Never throws. */
export async function clearAllCaches(): Promise<void> {
  if (typeof caches === 'undefined') return;

  try {
    const names = await caches.keys();
    await Promise.all(names.map((name) => caches.delete(name)));
  } catch (error) {
    // A failure here must not stop the sign-out that requested it: a member tapping Sign
    // out and staying signed in is worse than a cache that outlived its session.
    console.error('[offline] could not clear caches', error);
  }
}

/**
 * Everything a sign-out must forget on the device.
 *
 * The outbox is deliberately NOT cleared — see `lib/offline/outbox.ts`. Queued submissions
 * are the member's own unsent work, and discarding them on sign-out would silently lose the
 * three reports they filed in a basement.
 */
export async function clearDeviceState(): Promise<void> {
  await clearAllCaches();

  try {
    // The reporting draft. It holds a club id and whatever the member typed, which is not
    // contact data but is still theirs.
    sessionStorage.clear();
  } catch {
    // Storage can be unavailable in a locked-down browser. Not worth failing sign-out for.
  }
}
