# Open questions — amorist QA Discovery

Mode: Discovery, 2026-07-26/27. No tests written, no contract written.
Decisions are in `.qa/decisions.yaml`, risks in `.qa/risks.yaml`.

## Settled

The quality model, restated by the user from scratch on 2026-07-27, is three
properties (P1/P2/P3 in decisions.yaml) plus the rules that make them precise:

| # | Settled | Where |
| --- | --- | --- |
| P1 | Neutral edit leaves the file byte-identical, on **any** .md file | P1, D-010 |
| P2 | The WYSIWYG shows the file's line structure; no reflow, ever | P2, D-017 |
| P3 | The caret survives a mode switch, matched **by character** | P3, D-019 |
| — | Save is source-preserving: untouched regions copied verbatim | D-010 |
| — | Diff locality is **line-level**, not block-level | D-012 |
| — | A touched block whose content is unchanged is restored verbatim | Q-005 answer |
| — | Table auto-alignment is dropped; becomes an explicit command | D-012, D-013 |
| — | List markers and numbering are preserved as the author wrote them | D-012 |
| — | Enter writes a bare newline, like Sublime or Zed | D-018 |
| — | Verified in a real Chromium (editor) + Rust tests on real files (disk) | D-014 |
| — | Blocking gate from day one; it blocks publication, checks run on every push | D-016, D-025 |
| — | Perimeter: Tauri only; checks load `web/editor/` standalone | D-020 |
| — | Fixtures: synthetic only, modelled on four real document families | D-021, D-026 |
| — | Invisible characters preserved verbatim; amorist never tidies up | D-022 |
| — | Paste is in contract under one rule: nothing disappears silently | D-023 |
| — | Unsaved work: separate working copy, recovery offered on restart | D-024 |

## Still open

None. All thirteen Discovery questions are answered; the five that remained after
the first pass were closed on 2026-07-27 (D-022 invisible characters, D-023 paste,
D-024 unsaved work, D-025 gate placement, D-026 fixtures).

The only item carried into QA Design is not a question but a task: write the
synthetic corpus imitating the four document families listed in D-026.

## Closed

- Q-001 what counts as content loss → superseded by the 2026-07-27 restatement.
- Q-002 whose AST is the oracle → moot: P1 is byte-level, the oracle is the
  original file. An mdast comparison remains useful only as a diagnostic that
  explains *why* bytes differ.
- Q-003 domain of the promise → D-010. Q-004 locality unit → D-011, then D-012.
- Q-005 touched-but-unchanged block → restore verbatim. Q-006 → D-012.
- Q-007 verification level → D-014. Q-008 gate policy → D-016.
- Q-009 reflow → D-017. Q-010 Enter key → D-018. Q-011 caret → D-019.
- Q-012 perimeter → D-020. Q-013 fixtures → D-021.
- Q-014 fixtures source → D-026 (synthetic only, modelled on four families).
- Q-015 gate placement → D-025. Q-016 paste → D-023.
- Q-017 unsaved work → D-024. Q-018 invisible characters → D-022.

## Discovery closed 2026-07-27

25 decisions, 15 risks, every risk contradicting the quality model and every one
carrying the evidence that produced it. Next mode: QA Design — propose
`qa-contract.yaml` (status: proposed), `risk-register.yaml`, `eval-matrix.md`,
`architecture.md`. No test code until the contract is explicitly approved.
