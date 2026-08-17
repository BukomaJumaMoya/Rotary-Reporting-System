# 18 — Design System

**The operative specification.** Written from two design briefs: the first established the
token foundation, the second raised the register to institutional grade and superseded parts
of the first. This document is the merge, so that there is one place to look rather than two
that disagree. Where it says *superseded*, it means the first brief said otherwise and the
second overruled it.

Implemented in the M4 design pass. See `10-Build-Log.md` §4 for the build narrative and for
what was deliberately deferred.

---

## 0. The thesis

The audience for what this system produces is people who have read a thousand reports:
country directors, agency staff, task team leaders, permanent secretaries, and the district's
own officers. They are not impressed by software that looks impressive. They are impressed by
software that looks **correct**.

**The move is subtractive.** Everything that reads as institutional authority is achieved by
removing — animation, colour, decoration, marketing voice. What is added is not ornament but
**rigour**: provenance on every figure, units on every column, methodology within reach of
every derived number.

The reference points are the OECD Factbook, Eurostat, IMF Article IV staff reports and the
ONS. Not consumer software.

**The sentence to design against:** a Director-General should be able to screenshot any
screen, paste it into a board paper, and have it look like it belongs there.

**The constraint that shapes everything:** 250 KB of initial JavaScript, over metered Android
data, in Kampala and upcountry. This is not in tension with the above. Quiet is cheaper than
loud.

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

### The retreat of brand colour

*Superseded: cranberry was the primary action AND the active navigation state.*

Cranberry now appears in **three places only**: the brand mark and sign-in, the single primary
action on a page, and one chart series. Everything else is ink on paper — including the active
navigation state, which is a 2px ink rule and a weight change.

The focus ring stays cranberry. A focus ring must be unmistakable, and that is the one job
colour does best.

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

## 4. Tables

The primary artefact. This audience reads tables fluently and judges the product on them.

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

**The principle:** motion draws the eye, and in an analytical interface the eye should be
drawn by the data, not the chrome.

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

## 8. Carried over unchanged from the first brief

Spacing scale (4px base, fixed steps), radii and the nested-radius rule, breakpoints, the six
interaction states on every interactive element, forms (labels above inputs always; single
column; 720px maximum), the 250 KB payload budget, and the rule that **every colour is a
token** — no literal hex in any component, ever.

---

## 9. Deferred, and why

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
