# QA audit — amorist

Contract: `.qa/qa-contract.yaml`, status **approved**, 2026-07-28.
Repository state: `a9d7e73` plus the QA build.

A green suite that has never been shown to fail is not evidence. This file
records what was broken on purpose and whether the suite noticed.

---

## Mutations applied to the checking system

The first thing to establish, before any result about the product means
anything: can the apparatus fail?

| Mutation | Expected | Observed |
| --- | --- | --- |
| Fixture directory emptied | run fails, names the empty corpus | non-zero exit, "contains no .md files" |
| Stand-in browser path pointed at a non-existent binary | run fails, names the engine | non-zero exit, engine reported unavailable |
| Shipping engine's driver path pointed at a non-existent binary | run fails, names the engine | non-zero exit, with the install command in the message |
| Shipping engine's driver not installed at all | run fails rather than passing on the other engine | non-zero exit, engine listed under "unavailable" |
| A requirement left with no check | run fails, names the requirement | non-zero exit, one line per uncovered requirement |

These are automated: `checks/family-g.js` re-applies the first three on every
run by starting the runner as a sub-process with a deliberately broken
configuration and requiring a non-zero exit **and** a named cause.

## Mutations applied to the product

| Mutation | Expected | Observed |
| --- | --- | --- |
| Conflict detection removed from the write path | the outside-modification check fails | `qa_req_f2_a_file_changed_outside_is_not_overwritten` failed; the other three still passed |
| Temporary file plus rename replaced by a direct write | the atomicity check fails | `qa_req_f1_a_failed_write_leaves_the_original_intact_and_no_debris` failed; the other three still passed |

Both mutations were caught by exactly one check each, which is the useful
outcome: a mutation that reddens everything proves only that something is
watching, not that the right thing is.

## Defects found in the checks themselves

Six so far, and every one the same kind: a check, a report or a document
asserting something it had not earned. Recorded at length because this is the
failure the whole apparatus exists to prevent, reappearing inside the apparatus
— including once inside a measurement added specifically to prevent it.

1. **A paragraph finder that ignored fenced code blocks.** It selected the lines
   of a code sample, where line breaks are preserved by definition, and reported
   a PASS for a view requirement the product does not meet. Fixed by giving the
   checks a shared structural reader that classifies lines before aiming at
   them.
2. **A quiet flag on the Rust invocation.** It suppressed the test names the
   parser needed, so the filter matched nothing. Caught by the rule that a
   filter selecting nothing must fail rather than pass — the rule paid for
   itself the first time it was needed.
3. **Two code paths that had drifted.** Checks that judge the run rather than
   the editor ignored their own "not exercised" list and reported PASS having
   measured nothing. Both paths now share one verdict rule.

4. **A residue described more narrowly than it was.** The gap between the engine
   under test and the engine in the product was written as a macOS problem. It
   was sitting on Linux too, unnamed, because the document assumed which host
   was being driven instead of reading the one the runner printed.
5. **A font declared pinned that was not.** The harness names a font stack whose
   faces do not all exist on every platform, and claimed the font was fixed
   rather than inherited. Then the correction overstated the divergence: measured,
   the metrics agree, because the two faces that win share the advance ratio
   conventional to monospaced faces. Both the claim and its correction were
   reasoned; neither was measured until a real machine was asked.
6. **A measurement that measured itself.** The probe added to stop the previous
   defect took the surface's class to pick up the font, and the class carries a
   fixed width — so it measured the container and returned the same number on
   every platform. A constant that read as agreement. Twenty glyphs of a
   fourteen-pixel monospaced face cannot be over a thousand pixels wide; the
   figure was checkable at a glance and went unchecked for a commit, because it
   said what was hoped for.

Two of the six were found by asking why something PASSED rather than by any
failure. Nothing in the suite would have reported either. The other four were
found by reading what a machine actually printed instead of what the code
intended — which is the only defence that has worked more than once.

## Unresolved gaps

- **No mutation evidence for families A to D.** Those requirements are red
  today, so reintroducing a defect into the codec changes nothing observable —
  a check already failing cannot be shown to fail *for the right reason* by
  breaking it further. The mutation table in `.qa/architecture.md` becomes
  applicable the moment each requirement goes green, and until then this is a
  hole, not a pass.
- **No application-level layer.** Two requirements — recovery of unsaved work,
  and never writing the user's file except on an explicit save — need the built
  application started and killed. The suite reports them as not measured, which
  keeps the run red. Separately: the product writes no working copy anywhere, so
  the first has nothing to recover even before the question of measuring it.
- **The application's own embedding of the engine is covered nowhere.** Every run
  drives the shipping engine inside a test host — the reference browser that
  comes with the Linux driver, the system browser on macOS — never inside the
  webview the application embeds. The engine is covered on both platforms; the
  embedding on neither. This was first written as a macOS-only gap, which
  claimed a completeness on Linux that never existed.

## Closed since the first pass

- **All seven edit gestures are now driven**, not three. Pasting several lines,
  typing over a selection spanning several lines, a toolbar command, indenting
  one list item with the tab key, and undo and redo joined the three that were
  already there. Nothing in this family is declared and unexercised any more.
- **The caret resting on a marker that exists only in the source** is now
  checked in both halves the contract asks for: that the mapping lands on the
  first visible character of the construct, and that the same starting position
  produces the same landing twice. A mapping that is not deterministic cannot be
  relied on even on the occasions when it is right.

Two findings came out of writing them.

**Undo and redo already hold.** Of the seven gestures, this is the only one that
passes, on every fixture and both engines. The reason is instructive: the
history keeps the document as text and puts the same text back, so it never goes
near the part of the product that damages files. It is worth noting because it
is evidence about WHERE the damage is, not only that it exists.

**The first version of the list-indent check could not fail for the right
reason.** It searched the view for the item's source line, marker included —
which the view does not render — so it always reported a caret it could not
place, never a line that should not have moved. A check that fails for its own
reasons measures nothing, and it looks exactly like a check that works. Found by
reading the failure text rather than the failure count.

## A weakness found by a question, not by a failure

Asked whether the caret check ran on a document long enough to mean anything,
the corpus was measured rather than defended. Two answers came back.

The length was inadequate: the longest fixture was 874 characters over 50 lines.

The second answer was worse and nobody had asked for it. The check compared a
single character before and after the switch, and **64 of 75 probe positions
sat on a character occurring many times in the same file** — several on a space
appearing 167 times. A mapping landing on entirely the wrong offset would report
"same character" in the great majority of cases.

Stated precisely, because the distinction matters: that weakness is **latent,
not active**. Today the caret is not carried across the switch at all — it lands
past the end of the document — so the old comparison did fail, for the right
reason, by accident. It would have started passing wrongly as soon as the
mapping became partly right, which is exactly when a check stops being watched.

Both are closed. A 186-line fixture joined the corpus, and the assertion is now
anchored to tokens occurring **exactly once** in the document: the caret must
land inside that one occurrence at the same offset within it. There is one place
in the file where that word is, so landing there by accident is not available.
The check also fails if too few anchors could be probed, so a corpus of short
files cannot quietly reduce this requirement to nothing.

## Release readiness

Not claimable. Nineteen of twenty-one blocking requirements fail or are
unmeasured, and the two that pass are the ones that already held before this
work started. Adding to those: within the requirement on line locality, one of
seven gestures — undo and redo — already satisfies its clause, which is a
sub-result rather than a requirement met.
