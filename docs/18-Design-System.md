# 18 — Design System

**The operative specification.** Written from three rounds of design direction: a token
foundation, an institutional-grade pass that superseded parts of it, and a correction that
walked back the austerity when it turned out to be solving the wrong problem. This document
is the merge, so there is one place to look rather than three that disagree.

Where it says *superseded*, an earlier round said otherwise and was overruled. Those notes
are kept deliberately — the reasoning is worth more than the conclusion, and a rule whose
history is invisible gets re-litigated every six months.

Implemented across the M4 design passes. See `10-Build-Log.md` §4 for the build narrative and
the deferred list.

---

## 0. The thesis, and the correction

The audience for what this system PRODUCES is people who have read a thousand reports:
country directors, agency staff, task team leaders, permanent secretaries, and the district's
own officers. They are not impressed by software that looks impressive. They are impressed by
software that looks **correct**. Reports, exports and printed output are built for them, and
the document apparatus in §3 exists entirely to serve that.

**But the audience for the INTERFACE is a club secretary on a phone at eleven at night**, and
those are not the same problem.

The institutional round applied the report register to the whole application: shadows removed
entirely, every surface set to the same value, brand colour cut to three appearances, motion
subtracted to near-nothing. On a published page that is discipline. In an interface it
produced screens where a card was exactly the same colour as the page behind it, with no
elevation and a hairline border — which does not read as restrained, it reads as **unstyled**.

So the operative rule is a split, and it is the most important sentence in this document:

> **Report surfaces are austere. Working surfaces are warm.**
> A scorecard, an export and a printed page use the document apparatus, the muted data
> palette and near-zero motion. A list, a form and a dashboard get elevation, surface
> separation, status colour and the brand colour marking what is actionable and what is
> current.

**The constraint that shapes everything:** 250 KB of initial JavaScript, over metered Android
data, in Kampala and upcountry. Quiet is cheaper than loud, and neither register threatens it —
the build sits at 103.8 KB.

**A diagnosis worth remembering.** Two full design passes rebuilt the shell and the controls
and left the application looking unfinished, because the page bodies were never touched: 156
raw Tailwind sizes against 12 uses of the type scale, and every layout a bespoke stack. A
design system that does not reach the page body has not been applied. The fix was §8, not a
third palette.

---

## 1. Typography

The largest single lever, and where the register is set before a word is read.

| Role | Family | Use |
|---|---|---|
| Editorial | **Source Serif 4** | Page titles, section headings, long-form prose |
| Interface | **IBM Plex Sans** | Navigation, labels, controls, table content |
| Figures | **IBM Plex Mono** | Identifiers, RI numbers, reference codes |

*Superseded: the first brief specified Inter and Fraunces. Fraunces is warm and
characterful — right for a consumer product, slightly informal for a ministry.*

**Subsetting.** Source Serif carries the weight axis only (49.6 KB, against 119.5 KB with the
optical-size axis). Plex Sans is variable across 400–600 (44.6 KB). Plex Mono is a single
weight (14.4 KB) and is **not preloaded** — the browser fetches it the first time an
identifier renders, which is what "load Mono lazily" means in practice.

### Scale

| Token | Size | Family | Use |
|---|---|---|---|
| `title` | 2rem | serif | Page title |
| `section` | 1.375rem | serif | Numbered section heading |
| `subsection` | 1.125rem | serif | Sub-heading, mobile card heading |
| `figure-xl` | 2.75rem | sans | Headline statistic |
| `figure-lg` | 1.75rem | sans | Card statistic |
| `body` | 0.9375rem | sans | Interface default |
| `prose` | 1rem | serif | Long-form reading, max 68ch |
| `table` | 0.875rem | sans | Table content |
| `label` | 0.8125rem | sans | Field and column labels |
| `meta` | 0.75rem | sans | Source lines, footnotes, provenance |
| `code` | 0.8125rem | mono | Identifiers |

**There is no 3.5rem display size.** A 56px number is a marketing gesture. The headline
statistic tops out at 2.75rem and earns attention through position and whitespace.

### The numeric contract

`font-variant-numeric: tabular-nums slashed-zero` on `:root`; prose restores proportional
figures. Tabular stops a recomputing figure jittering and lets a column align; the slashed
zero stops `0` being read as `O` in a reference code transcribed down a phone line.

Also required, and enforced by review rather than by code:

- Consistent decimal places within a column. `4.0` and `4.00` never share a table.
- Units in the **header**, never repeated in every cell.
- No false precision. A percentage over 12 clubs gets zero decimal places.
- **Zero is `0`; `—` means not applicable; blank means not available.** Three different
  facts, and conflating them is the classic amateur tell.
- Percentages carry their base where the denominator is not obvious: `68% (n = 47)`.

### Voice

Third person. No contractions in published copy, no exclamation, no emoji, no marketing
adjectives. Dates in full — **14 November 2027**, never US ordering. Times with the zone —
**14:30 EAT**.

---

## 2. Colour

Six hues generated in OKLCH, twelve steps each, chroma peaking mid-ramp. Ramps carried over
from the first brief unchanged; their **application** did not.

### How much brand colour

This was argued twice and settled by the register split.

**On report surfaces — scorecards, exports, print — cranberry appears three times at most**:
the mark, the single primary action, and one chart series. Everything else is ink on paper.
A report that is mostly brand colour reads as promotional, and promotional is the one thing a
figure in a board paper must not read as.

**On working surfaces, cranberry marks what is ACTIONABLE and what is CURRENT.** The primary
action, the active navigation item, the selected filter, the focused control.
*Superseded: the institutional round put the active navigation state in ink.* That rule is
right for a printed page and wrong for a tool somebody opens weekly, where the brand colour is
most of how a screen becomes recognisable at a glance. It is still not decoration — it never
marks something that is merely present.

The focus ring is cranberry in both registers. A focus ring must be unmistakable, and that is
the one job colour does best.

### Paper and ink

**Light warms toward paper at hue 85** — a faint cream, not the brand hue. This is what makes
a screen read as a printed page rather than as an application. **Dark cools toward slate at
hue 260**; a warm dark mode reads as sepia and looks dated. The two modes deliberately do not
share a hue.

Danger is **ember at hue 30, not red**. Cranberry *is* red, and a red destructive button would
read as the primary action in a system whose destructive actions include erasure and rollover.
Never place cranberry and ember buttons adjacent.

### Data colour

An ordered, muted sequence: deep blue · cranberry · petrol · gold · leaf · aubergine.

**A single-series chart is deep blue, not cranberry.** Brand colour on every chart reads as
promotion; an institutional chart uses a neutral analytical colour.

**Provisional data is hatched, not tinted** (`hatched` utility). A hatch survives greyscale
and a photocopier; a tint does not, and a board pack printed in black and white is the normal
case.

---

## 3. Document apparatus

`components/ui/document.tsx`. This is what makes the interface read as a report.

**`Provenance` — the most important component in the system.** Origin, verification status,
as-at time, coverage. Coverage is what separates a credible reporting system from a dashboard:
a donor or ministry reader asks "of how many, and what about the rest?" within seconds of any
aggregate, and answering before being asked wins the argument. **Never truncated** — it wraps
at every width, because a half-shown provenance line looks like concealment.

**`Caption`** — `Table 3 — Club performance by parameter, Q2 2027-28`. States *what*,
*disaggregated how*, and *when*. Above a table, below a figure.

**`Section`** — numbered, with the number in the margin at ≥lg and inline below that. This
does more for perceived seriousness than any visual treatment, because it signals the content
has a structure somebody thought about.

**`DocumentHeader`** — title, period, district, office, and status. **Draft**, **Provisional**
and **Final** are meaningful words to this audience; a provisional figure quoted as final is
how somebody corrects a minister in public.

**`Statistic`**, **`Identifier`** — a headline figure with its unit at `meta` size beside it,
and mono-set identifiers.

---

## 4. Tables, and when NOT to use one

A table is for **comparison**: the reader is scanning a column, matching magnitudes, checking
one row against its neighbour. Finance is exactly that, and finance keeps its tables.

A **list** is for **identification**: the reader is looking for one record by name and then
opening it. Clubs, activities, members, appointments and positions are all that, and all of
them became lists (`ListGroup` / `ListRow` in §8). The tell that a table was the wrong
container is a column whose cell content is a joined string of unrelated facts — the old
Activities table had an "Evidence" column that was `2 photos · 14 attendees · 1 partner`,
which is a list item's subtitle wearing a column header.

When it IS a table, this audience reads them fluently and judges the product on them:

- **Horizontal rules only.** No vertical rules, no cell borders, no zebra striping. A strong
  rule under the header, hairlines between rows, a strong rule above a total.
- **Sentence-case headers, not uppercase.** *Superseded: the first pass had uppercase tracked
  headers.* Uppercase headers are a web convention, not a publication one.
- Units in the header in parentheses at `meta` size.
- Numbers right-aligned and tabular; text left-aligned. A data column is never centred.
- Row height 44px. Total rows in **medium weight above a rule**, never bold and filled.
- **Mobile: definition cards.** *Restructure, never hide* — every figure available on desktop
  is available on a phone. A mobile view that drops columns cannot be trusted.
- The pending state is a **static label**, not a pulse. *Superseded: the first pass used an
  opacity pulse.* A pulsing row draws the eye to the least settled thing on the page and
  cannot be screenshotted, printed or read aloud.

---

## 5. Motion

**Reduced to near-invisibility.** The largest departure from the first brief.

| Permitted | Duration |
|---|---|
| Opacity on state change | 120 ms |
| Overlay entry and exit | 160 ms |
| Disclosure | 180 ms |
| Skeleton to content | 100 ms |

**Removed:** score count-ups, progress-arc draw-ins, spring easing, list stagger, haptics, the
optimistic pulse, and anything scroll-driven.

The press scale (`scale(0.98)`) survives. It is feedback rather than spectacle, and it is most
of what makes a control feel like a control on a touchscreen.

**The principle:** motion draws the eye, and the eye should be drawn by the data, not the
chrome.

The removals stand — no count-ups, no arc draw-ins, no stagger, no springs, no haptics, and
nothing scroll-driven, on any surface. What survived is feedback rather than performance: the
`scale(0.98)` press, a colour transition on hover, and an overlay that fades. That is most of
what makes a control feel like a control on a touchscreen, and none of it is spectacle.

---

## 6. Print

**This audience prints, and pastes into board packs.** A real print stylesheet exists in
`index.css`: A4 portrait, 20mm margins, forced light palette, chrome hidden via
`[data-print="hide"]`, `break-inside: avoid` on tables and figures, `thead` repeated across
pages, URLs rendered after links, and hatching that carries encoding with backgrounds
stripped.

**Check it by printing, in greyscale.** Not by imagining it.

---

## 7. Accessibility

WCAG 2.1 AA throughout, **AAA contrast on body text** — the ink-on-paper palette reaches
roughly 15:1 on primary text, well above the 7:1 AAA requires. This also aligns with EN 301
549, which matters for institutional procurement.

Skip link, visible focus, trapped and returned focus in dialogs, real `<table>` semantics,
never colour alone, 44px targets, and a published statement at **`/accessibility`** —
deliberately outside authentication, because a procurement officer deciding whether the system
is usable cannot sign in.

---

## 8. Page-level blocks

`components/ui/page.tsx`. The layer that was missing, and whose absence made two rounds of
token work invisible.

`ui/index.tsx` holds CONTROLS — a button, an input, a table. These are what a SCREEN is made
of, and until this existed every page hand-rolled its own layout.

| Block | Job |
|---|---|
| `PageLayout` | Content width by page type. `form` is 720px — a form at 1280px is a hostile form, because the eye travels the full width between a label and its control. List screens inherit the shell's 1280px and need no wrapper. |
| `StatGrid` | The band of figures at the top of a list screen. Answers "what am I looking at, in numbers" before the reader parses a row. Two across on a phone, always. |
| `ListGroup` / `ListRow` | Title, middle-dot separated facts, badges, optional trailing figure or action. Roughly half of every screen in the system is a list of something, so this is the component that most determines how the application reads. |
| `FilterBar` | Sticky under the header. On a phone, a filter you must scroll up to change is a filter nobody changes twice. |
| `FilterTabs` | A segmented control for the two or three filters people reach for constantly. On a list screen the available filters are part of the information; hiding them in a dropdown makes people forget the list is filtered at all. |
| `SearchField` | Unlabelled and growing — belongs to the bar, not to a form. |
| `SectionHeading` | A heading inside a page, with an optional count and action. |

**A filter bar is not a form.** Several screens opened with a card of labelled `Select`s in a
grid, which reads as something you must fill in before the list below is valid. Search and the
one or two live facets go on the bar; the rest goes behind a "More filters" disclosure that
shows a dot when any of them is set.

**Actions belong on the row** when they are the reason the screen exists. Corroborating a
transition is a district officer's whole task on that page; behind a tap it would make forty
transitions eighty taps.

---

## 9. Carried over unchanged from the first brief

Spacing scale (4px base, fixed steps), radii and the nested-radius rule, breakpoints, the six
interaction states on every interactive element, forms (labels above inputs always; single
column; 720px maximum), the 250 KB payload budget, and the rule that **every colour is a
token** — no literal hex in any component, ever.

---

## 10. Deferred, and why

Not built, because the screens they belong to do not exist yet. Recorded here so the intent
survives to the milestone that owns them.

| Item | Blocked on |
|---|---|
| Chart house style, small multiples, direct labelling, bullet charts | No charts exist in the application |
| Sparklines and bar-in-cell | Same |
| "View as table" toggle | Same |
| Revision markers (`r`), series-break notation | `assessment_period_results` — M5 |
| "How is this calculated?" methodology panel | `assessment_scores.evidence` — M5 |
| Contents rail on long report surfaces | No report surface is long enough yet |
| PDF export; XLSX cover sheet with method notes | Export pipeline |
| Command-palette record search | Needs a server-side filtered search endpoint; doing it client-side would ship the district's member list to every device, which is the failure this system exists to correct |

**One deliberate divergence.** Both briefs describe a mobile bottom bar. The application uses
an overlay drawer instead: fifteen destinations had already broken a bottom bar once, at about
24px per item on a 360px screen. The second brief's §7.4 permits the drawer, and the district
developer chose it explicitly.
