---
name: close-milestone
description: Close a milestone (M0…M10) by verifying the build, reviewing axiom conformance, and updating every document a fresh session needs. Use at the end of the last session of a milestone, or when asked to "close M2", "wrap up the milestone", or "update the docs after finishing this step".
---

# Closing a milestone

The next milestone is implemented in a **new session with no memory of this one**. Whatever
is not written down is lost — not degraded, lost. The build log, the API spec and the schema
file are the entire handoff.

This is also the moment to catch the thing that actually kills a project like this: not a
decision to abandon a design principle, but three weeks of reasonable fixes that quietly
left one behind. §4a of the build log exists for that and is not optional.

Work through the five parts in order. Do not skip part 2 because the code compiles, and do
not skip part 3 because you are confident nothing drifted — the confidence is the problem.

---

## 1. Establish what actually happened

Read, before writing anything:

- `git log --oneline <previous-milestone-tag-or-first-commit>..HEAD` — every commit of this
  milestone.
- `docs/10-Build-Log.md` §0, §0a and §4a as they stand — they describe the PREVIOUS
  milestone and you are about to replace them.
- The session prompt document for the milestone just built
  (`docs/NN-ClaudeCode-M*-Sessions.md`).

Then assemble three lists. Write them down; they are the raw material for parts 3 and 4.

**Bugs found and fixed.** For each: what was broken, how long it had been broken, what
nothing caught it, and what now would. The last part matters most — a fix with no new test
or check is a bug that will return. M0 session 6 found that guard SQLSTATEs had never
reached the error mapper since session 3, and every guard violation had been a silent 500;
the fix was one line, and the value was the test that now proves the translation.

**Adjustments to the design.** Anywhere the code ended up different from what `docs/`
describes. For each, decide explicitly: is the document wrong and the code right (amend the
document), or is the code wrong (record it in §5 as work outstanding)? Do not leave it
ambiguous. Both have happened here — `docs/05-API-Spec.md §1`'s `RequestScopes` was too
narrow and the document was amended; the rollover step order in the session prompt was
impossible and the prompt was wrong.

**Assumptions in the session prompts that turned out false.** These are the highest-value
notes in the whole log, because the next milestone's prompts were written by the same person
at the same time and carry the same blind spots.

---

## 2. The verification gate

Everything must pass before you write a word of documentation. Documenting a state you have
not verified is how a document starts lying.

```bash
npm run typecheck && npm run lint && npm run format:check
npm run test:report          # writes .tmp/vitest-report.json, which docs:check reads
npm run build

cd apps/api && npx prisma migrate diff \
  --from-migrations ./prisma/migrations --to-schema prisma/schema.prisma --script
# must print exactly: "This is an empty migration."
```

Record the test count from the report — it goes in the state line.

If something fails, fix it now. A milestone with a failing test is not closed, and writing
"known failure" into the build log is choosing to hand the next session a broken tree.

---

## 3. Axiom conformance — the part with judgement in it

Rewrite `docs/10-Build-Log.md` §4a, one row per axiom, for this milestone.

Run the mechanical half first:

```bash
npm run docs:check
```

It proves the greppable invariants: no `districtId` on `Club`, no writes to
`membership_events` or `club_rosters`, no raw SQL outside `modules/assessment/resolvers/`,
no float money, no naive timestamps, and that the no-PII harness still names the fields it
is supposed to forbid. **Passing this is not the review.** It cannot see a resolver that
takes a shortcut, an endpoint that returns a field it should not, or a scope check written
in a handler instead of the layer.

For each of the six axioms ask, specifically about code written **this milestone**:

1. **The Rotary Year is a dimension.** Did anything read or write across years without going
   through two scoped contexts? Did any query grow a hand-written `rotaryYearId` filter — a
   sign the layer was worked around rather than used?
2. **District affiliation is temporal.** Did anything acquire a shortcut from a club to a
   district that skips `club_district_affiliations`? Including a join, a view, or a cached
   field.
3. **Membership is an event log.** Did anything update or delete an event, or write to the
   roster? Did a correction get implemented as an edit?
4. **One activity model.** Did any activity-shaped thing get its own table or its own
   endpoint instead of an `activity_types` row?
5. **The assessment rubric is data.** Did any threshold, weight or criterion end up in
   TypeScript? A constant named `PASS_MARK` is the shape of this failure.
6. **Personal data is private by default.** Did any new endpoint return a contact field? Does
   every new upload path strip EXIF? Does every new person-shaped response go through
   `person_visibility`? Treat every answer here as high-stakes: this is the failure the
   project exists to correct.

Write the honest answer. **A row may say an axiom was bent** — recording that is the whole
point, because an axiom nobody may ever qualify is one people route around silently instead.
If a row says _bent_, it also says what would have to be true to straighten it, and gets a
row in §5.

If an axiom was **broken** rather than bent, stop. Do not close the milestone. Say so
plainly to the user, with the file and the line, and propose the fix. This is the one place
in this workflow where the right move is to halt rather than to document.

---

## 4. Update the documents

Each has one job. Update all of them; a half-updated set is worse than a stale one, because
the reader cannot tell which half to trust.

| Document                       | What must be true when you are finished                                                                                                                                                                                                                                                                                                                                                             |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `docs/10-Build-Log.md`         | The state line matches reality. §0 handoff and §0a rules rewritten for the milestone just closed. §1 tables carry every session and its commit. §3 code map names every source file that now exists. §4 records the decisions, the bugs and the false assumptions from part 1. §4a is the review from part 3. §5 has the built rows removed and the newly-deferred rows added. §6 has any new trap. |
| `docs/schema.sql`              | Every migration this milestone is reflected, with a `-- vN.N` header saying what changed and naming the migration. **Bump the version.** Then prove it — part 5 rebuilds and diffs it.                                                                                                                                                                                                              |
| `docs/05-API-Spec.md`          | Every new endpoint documented and marked built, separately from the design target. Every new permission in §10. Every new code in the `**Built:**` list of §1. `docs:check` verifies all three.                                                                                                                                                                                                     |
| `CLAUDE.md`                    | "Current phase" names this milestone complete and the next one next. Any new non-negotiable rule from §0a is stated here too — this is the file that is always in context.                                                                                                                                                                                                                          |
| `docs/07-Roadmap.md`           | Milestone ticked, with a status block saying what landed and what did not. If an exit condition is unmet, say so rather than ticking around it.                                                                                                                                                                                                                                                     |
| `docs/11-Build-Conventions.md` | §4 marks as BUILT anything that was "planned". §7's "where the design package is wrong" moves fixed rows into the amended table.                                                                                                                                                                                                                                                                    |
| `README.md`                    | Repository layout, test suites, and any new command or environment variable. This is what someone who is not you reads first.                                                                                                                                                                                                                                                                       |

Two rules for the prose:

- **Write down why, not just what.** "Rollover deactivates appointments before locking the
  year" is a fact the code already states. "…because locking first would refuse the
  deactivation, which is a write into the locked year" is the thing that stops the next
  person reintroducing it.
- **Numbers are claims and get verified.** Test counts, permission counts, invariant counts.
  `docs:check` verifies these because prose numbers are the first thing to rot — the seed
  said 29 permissions for a month after it made 32.

Update the state line last, from measured values:

```
<!-- dis:state milestone=M2 schema=v1.8 tests=341 -->
```

---

## 5. Prove it, then commit

```bash
npm run docs:check -- --strict --with-db
```

`--strict` makes a warning or a skip a failure. `--with-db` rebuilds `docs/schema.sql` into
`dis_schema_check` and diffs the catalog against the migrated development database — the
check that found the `session` table had been live and undocumented since M0 session 3.

**A skipped check has proved nothing**, and at a milestone boundary that is not good enough.
If one cannot run, say so to the user in your summary rather than letting the tick imply a
verification that did not happen.

Commit as a `docs:` change. The message should let someone reconstruct the milestone without
the diff: what was built, what was found broken, what was adjusted and why, and what
verification was run. Include the axiom conformance result in one line.

Then tell the user, briefly: the milestone is closed, what the next session should be told to
do, and anything outstanding that will shape it.

---

## Notes

**A §5 row whose milestone has arrived fails the strict gate.** Build it, move its target
out, or — if it is genuinely held open by something outside the code — add the word
`carried` to its target cell along with the reason. `carried` silences the check
permanently for that row, so it is the one thing here that should feel like a decision.

**When only a session inside a milestone is finished**, not the milestone itself, this is too
heavy. Update §1, §4 and the code map, run `npm run docs:check`, and stop.

**If the user asks to close a milestone that is not finished**, say which parts are
incomplete and ask whether to close it as partial — a partial close is legitimate, but it
must be recorded as one in §1 and §5, never papered over.
