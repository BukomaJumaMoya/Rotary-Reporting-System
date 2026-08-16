# 17 — The Real Device Pass

**M3 session 4 is not a coding session.** It is an hour with a phone, and it is the only
part of this milestone the test suite cannot do. Everything in `outbox.test.ts` proves the
queue behaves correctly given a response; none of it proves that a service worker registered,
that a photograph survived a screen lock, or that a member could tell what was happening.

Run this before M3 is called done. Record what happened in §3, whatever it was.

---

## 0. Before you start

**A service worker needs a secure context.** `https:` and `localhost` only. Opening the app
at `http://192.168.x.x` from a phone — the obvious thing to do — gets **no service worker at
all**: no install prompt, no offline shell, no Background Sync. The app still works and the
outbox still drains on its interval, but half of this checklist is untestable that way.

Two ways to get a secure context on real hardware:

```bash
# 1. Android over USB — the phone treats localhost:4000 as its own, so it is secure.
adb reverse tcp:4000 tcp:4000
#    Then open http://localhost:4000 on the phone.

# 2. Staging. The real thing, over real mobile data, which is what session 4 is actually for.
```

Use (1) to check the mechanics and (2) for the numbers. Only (2) tells you anything about
metered data.

**Use a mid-range phone, not your best one.** The whole design targets a member on a cheap
Android on metered data; a flagship on wifi will pass everything and tell you nothing.

---

## 1. The checklist

### Installation

- [ ] The install prompt appears on the **second** visit, not the first.
- [ ] "Not now" dismisses it and it stays dismissed across a reload.
- [ ] Installed, it opens without browser chrome, portrait, with the cranberry theme colour
      on the status bar.
- [ ] The icon on the home screen is the maskable one — not a white square with a small logo
      floating in it.

### The report path — the one that matters

- [ ] A club secretary who has never seen the app files a fellowship report with a
      photograph in **under three minutes**, unassisted, while you watch and say nothing.
      *(This is also the M2 exit test, still unrun. Do them together.)*
- [ ] The camera opens directly from "Add a photo" — not the gallery picker.
- [ ] Leaving the page mid-report and coming back keeps everything typed so far.

### Offline

- [ ] Aeroplane mode. The banner says there is no connection, and Submit still works.
- [ ] File **three** reports offline. The badge reads 3. `/pending` lists all three with
      their titles.
- [ ] Reconnect. Within thirty seconds, exactly **three** activities exist — not zero, not
      six. Check the list, not the badge.
- [ ] Repeat, but **kill the browser** between the third submission and reconnecting. Reopen.
      The three are still queued and still send.
- [ ] Repeat, but turn the **screen off** mid-upload. Does it complete, or queue and then
      complete? Either is acceptable; losing it is not.
- [ ] Induct a **new** person offline — one not already in the system. Both the person and
      the membership event queue, and on reconnect the person exists and is on the roster.

### The ambiguous failure — the case the whole design is for

- [ ] Throttle to a very slow connection, submit, and kill the tab while the request is in
      flight. Reopen and let it drain. **One** activity, not two.
- [ ] With a captive-portal-style network (a hotel or campus wifi that intercepts requests),
      the banner correctly says there is no connection rather than claiming to be online.

### iOS Safari

Safari has never shipped Background Sync, so the interval fallback is the whole mechanism
there.

- [ ] Queue a submission, close the tab, reopen. It drains.
- [ ] Confirm it does **not** drain while the app is closed. That is expected on iOS; the
      point is to know it, not to fix it.

### Data protection

- [ ] Sign out. Reopen. No cached member list, no cached club, nothing from the previous
      session — check with DevTools' Cache Storage over USB debugging.
- [ ] **Queued submissions survive sign-out.** They are the member's own unsent work, and
      losing them would be worse than the cache surviving. Verify both halves.

### Numbers to measure

Record actual figures, not impressions. DevTools over USB, Network tab, disable cache.

| Measurement | Budget | Actual |
|---|---|---|
| Initial JS, gzipped | 250 KB | |
| Full first load (JS + CSS + fonts + icons) | — | |
| Repeat visit, service worker warm | near zero | |
| An activity list response | — | |
| One report submission with one photograph | 500 KB | |
| A whole session: sign in, three reports with photos | — | |

---

## 2. What to do with a friction point

**Log it, do not fix it in the moment.** Every friction point becomes an M6 pilot fix, and
the value of this pass is the list, not the patches. A change made while the phone is in your
hand is a change made without a test.

The exception is anything that **loses data**. That is not friction; that is a bug in the
queue, and it stops M3 being done.

---

## 3. Results

*Not yet run.* Fill this in — date, handset, network, and what actually happened, including
the parts that went fine. A checklist with no recorded run is a checklist somebody will
assume was run.

| Date | Handset | Network | Outcome |
|---|---|---|---|
| | | | |

### Friction log

| # | What happened | Severity | Lands in |
|---|---|---|---|
| | | | |
