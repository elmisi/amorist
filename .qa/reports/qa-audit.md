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

Three, all of the same kind — a check reporting a result it had not earned.
Recorded because they are the failure this whole apparatus exists to prevent,
reappearing inside the apparatus.

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

The first was found by asking why a fixture passed, not by a failure. That is
worth noting: nothing in the suite would have reported it.

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
- **Four edit gestures declared but not driven**: pasting several lines, typing
  over a selection spanning several lines, a toolbar action or shortcut
  including indent and outdent, and undo and redo. They are named in every
  report rather than left out.
- **macOS is not covered by anything automated.** Named in every report with the
  manual pass that stands in for it, and scoped to the platform remaining
  published.

## Release readiness

Not claimable. Nineteen of twenty-one blocking requirements fail or are
unmeasured, and the two that pass are the ones that already held before this
work started.
