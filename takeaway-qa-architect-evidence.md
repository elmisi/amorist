# Takeaway Evidence: qa-architect

**Date:** 2026-07-27
**Based on:** A full Discovery + QA Design run against a real product (a local-first Markdown editor, ~5000 LOC across a Rust backend and a vanilla-JS frontend). One session, ~18 exchanges, 16 decision questions asked, 25 Discovery decisions and 18 risks recorded, 4 Design artifacts produced (21 requirements). No test code written, per the user's opening instruction "Non scrivere test: avvia solo la Discovery e fammi una domanda alla volta."
**Target file(s):** `~/.claude/plugins/cache/elmisi/qa-architect/0.1.0-beta.1/skills/qa-architect/SKILL.md`, `references/qa-contract-template.yaml`, `references/mutation-catalog.md`, `assets/synthetic-markdown-editor-pilot.md`; missing templates for `decisions.yaml`, `risks.yaml`, `open-questions.md`
**Target scope:** universal (installed as a plugin, used across projects)

---

## Observed Patterns

### Pattern 1: Comprehension debt accumulates silently, then collapses all at once

- **Candidate principle:** An interviewer must surface the person's accumulated confusion on a cadence it controls, because a person defers small losses of understanding rather than reporting them, and the failure surfaces only as a total reset.

- **Observation:** After nine exchanges — two of which the user had already bounced back with "voglio chiarire" without answering — the user wrote: *"ripartiamo perché non ci sto capendo più niente"* and then restated the entire quality model himself, in three lines, in his own words. Those three lines became the foundation of everything that followed: the byte-identity promise, the source-faithful view, and the caret continuity. Asked in the interview what triggered the collapse, the user described the mechanism precisely:

  > "sicuramente l'accumulo, cominci a perdere un pezzo ma vai avanti pensando 'poi si chiarisce' ma quando questi pezzi sono troppi ed arriva una domanda per cui non hai idea della risposta capisci che hai accumulato troppo debito e servono chiarimenti"

  Note the shape: the person keeps answering correctly while their global understanding erodes. The debt is invisible from the outside precisely because the local answers keep arriving.

- **Frequency:** Observed once in this session as a full collapse, but the user confirmed the underlying mechanism as recurring across tools: *"in generale questa frizione l'ho spesso provata lavorando con coding agent che mi proponevano delle opzioni"*. Candidate recurring pattern.

- **Impact:** The nine exchanges before the reset produced two rejected questions and two decisions that were later marked superseded (`D-001` "what counts as content loss", `D-007` "AST identity + string identity"). The entire branch built on the second — which parser should serve as the comparison oracle, an investigation that consumed a question cycle and several probes — was discarded as moot once the user's own restatement made clear the model was byte-level. Roughly the first half of Discovery was rework.

- **Root cause:** `SKILL.md` says *"Pause periodically to ask the user to correct the interpretation."* That instruction has no cadence, no trigger condition, and no required form, and it places the burden of noticing the problem on the person being interviewed — who by construction is the one who cannot see it. In this session the first interpretation summary came only after nine exchanges, and it came *after* the user had already declared bankruptcy rather than before.

### Pattern 2: Selected answers were recorded with a provenance stronger than they had

- **Candidate principle:** Record who authored the wording of a decision, not only who agreed to it. An answer selected from options the interviewer wrote is weaker evidence than one the person formulated, and must remain provisional until it has been replayed with its consequences.

- **Observation:** Two decisions in this session were chosen, recorded as settled, and then materially revised once their consequences were made concrete:

  | Decision | First answer | Recorded as | Revised to | What triggered the revision |
  | --- | --- | --- | --- | --- |
  | How much of the file may change on a real edit | "only the touched block" | `D-011, source: user-statement, status: confirmed` | "only the touched line" | A measured table showing one cell edit rewriting 5 lines of 5, and a list written with one marker style being renumbered wholesale |
  | What the release gate blocks | "block everything from day one" | `D-016, source: user-statement, status: confirmed` | "block publication only" | Being shown that a gate on commits would block the very commits that make it green |

  In both cases the record already asserted `status: confirmed` and `source: user-statement`. The label was true about agreement and false about authorship. The user's own explanation of why this happens:

  > "le domande obbligano una scelta, soprattutto se non sai suggerire una alternativa, o forse una delle risposte è quasi quello che vorresti ma non sufficientemente diverso da quello che pensi per il carico cognitivo di riscrivere la risposta corretta, oppure spesso la pigrizia ed il fraintendimento ti fanno scegliere una risposta con leggerezza"

  The one time the user did reject all options and write his own answer — asked where the test fixtures should come from, he answered "aggiungi dei nuovi file ispirati a quelli che ho sul mio portatile" — the result was better than any of the three options offered, and it resolved a privacy constraint none of the options had addressed.

- **Frequency:** 2 confirmed revisions out of 13 answers given by selection in this session; 1 answer out of 14 given by free-text rejection of all options. Mechanism confirmed by the user as general, not specific to this session.

- **Impact:** The decision log overstated its own epistemic quality for as long as those two entries stood. Both had to be repaired with `supersedes:` chains invented ad hoc. More seriously: both revisions happened by luck, because the consequence surfaced later for unrelated reasons. Nothing in the method would have caught them otherwise, and both were load-bearing — the locality unit and the gate placement are two of the four most consequential decisions in the final contract.

- **Root cause:** `SKILL.md` requires recording each conclusion's source as *"user statement, repository evidence, recommendation, or assumption"*, and the contract template offers `status: confirmed | recommendation | assumption | unverifiable`. Neither scheme distinguishes "the person said this" from "the person picked this from a menu I wrote". Both collapse into "user statement / confirmed". There is also no notion of a decision maturing: nothing in the method says a decision is provisional until its consequences have been played back.

### Pattern 3: Abstraction-first questions were rejected; measurement-carrying questions were answered on first presentation

- **Candidate principle:** A decision question must carry the measured consequence of each option, expressed in the person's own domain. An abstraction that arrives without a worked example will not be answered — and if it is answered, the answer is not trustworthy.

- **Observation:** Three questions were bounced back unanswered. All three were framed in the method's vocabulary before any measurement had been shown:

  1. "What counts as losing user content?" with options framed as byte fidelity / subset fidelity / durability / semantic preservation.
  2. "Whose syntax tree is the oracle?" — the product's own parser versus a reference parser.
  3. An early version of the line-break question, which presupposed a keystroke behaviour that did not match the product's actual behaviour.

  Every question from that point on carried a measured table produced by executing the product's own code, and every one was answered on first presentation. Examples of what went into the questions: one cell edited in a five-row table rewrites all five rows, but rewrites only its own row if the new value is the same width; 29 of 31 documents in the repository end with a trailing newline and the product strips it from every one; a configuration default in another editor the user has installed silently deletes the exact characters one of the options would have written. The user's summary:

  > "sicuramente numeri e tabelle di confronto aiutano alla scelta, i concetti astratti hanno bisogno di esempi e di descrizione delle implicazioni per poter essere valutate"

  A sharper detail: the skill's own bundled pilot scenario instructs the agent to *"Ask whether an unmodified open/save must be byte-identical or semantically equivalent"*. That is almost verbatim the first question asked in this session — and it is one of the three that was rejected. The method's canonical example question failed against a real person.

- **Frequency:** 3 rejections, all abstraction-first; 13 first-pass answers, all evidence-carrying. Clean separation, no counter-examples in either direction.

- **Impact:** Two full question cycles wasted, plus the reformulation. Worse, the second rejected question opened an investigation into which parser should serve as the comparison oracle — probes, a working reference parser located in the dependency tree, a measured demonstration that the product's own parser is a fixed point on already-damaged content. All of it was discarded as moot when the user's restatement revealed the model was byte-level, where the oracle is simply the original file. The abstraction was not just hard to answer: it was the wrong axis, and no amount of rewording would have fixed it.

- **Root cause:** `SKILL.md` treats repository inspection as a way to *avoid* asking answerable questions — *"Read existing product material and inspect the target repository before asking a question that it already answers"* — rather than as the material that must go *inside* the question. Nothing in the method asks the agent to execute the subject's code to produce measurements. The instruction to use "concrete scenarios and alternatives" is satisfied by an invented scenario, which is exactly what the rejected questions contained.

### Pattern 4: Internal identifiers leaked into text addressed to the user

- **Candidate principle:** Identifiers that exist for cross-referencing inside artifacts must never appear in text addressed to the person.

- **Observation:** Property and decision identifiers (`P1`, `P2`, `P3`, `D-011`, `R-005`) were used in chat messages. The user's correction was explicit and covered more than identifiers: *"riformula le domande espandendo un po' le descrizioni, 'P1' per me non vuol dire niente, non usare acronimi, non dare per scontato"*. After the correction the leak did not recur, and question descriptions were expanded from roughly 30 words to roughly 90 words each.

- **Frequency:** Repeated across several messages until explicitly corrected; zero recurrence afterwards.

- **Impact:** One question cycle rejected and rewritten. Cheap in isolation, but it arrived stacked on Patterns 1 and 3, and contributed to the reset.

- **Root cause:** Nothing in the method separates artifact vocabulary from conversational vocabulary. The identifiers were invented by the agent (see Pattern 5) and then reused everywhere, which is the natural default when no rule says otherwise.

### Pattern 5: The Discovery artifacts have no schemas, unlike the Design artifacts

- **Candidate principle:** Every artifact a method names must ship with a schema; otherwise its structure is reinvented every session and cannot be reliably consumed by another agent or compared across runs.

- **Observation:** `SKILL.md` instructs the agent to maintain `.qa/decisions.yaml`, `.qa/risks.yaml` and `.qa/open-questions.md` throughout Discovery, but `references/` contains templates only for the four Design artifacts. All three Discovery schemas were invented in this session. Consequences: an inconsistent identifier scheme (`P1/P2/P3` for the three headline properties sitting inside a list otherwise keyed `D-NNN`), an entry appended into the wrong top-level section and needing repair, risk entries left out of numeric order after appends, two structural syntax errors in generated data files (a colon inside an unquoted sequence item, twice), and a `supersedes:` mechanism invented on the spot when decisions were revised.

- **Frequency:** Once, structural.

- **Impact:** Perhaps 20 minutes of avoidable repair work, and — more durably — three artifacts whose shape another agent cannot rely on. The `supersedes:` mechanism in particular is exactly the field Pattern 2 shows is needed, and it exists here only because this session happened to need it.

- **Root cause:** The reference set is incomplete relative to the workflow the instructions describe. Discovery is the mode the method spends the most words on and the only one with no schemas.

### Pattern 6: The method has no mode for "the contract specifies a product that does not exist yet"

- **Candidate principle:** A quality contract may specify a product that must still be built. The method must state what happens to the gate, to the ordering of work, and to the handoff to implementation when most requirements fail on the day the contract is signed.

- **Observation:** 17 of 21 requirements in the resulting contract fail against the current product; 3 pass; 1 partially. The contract is a specification, not a description. The user asked directly whether this was enough to proceed:

  > "un agente con il contratto ha tutto quello che gli serve per procedere e modificare l'app o mancano ancora dei pezzi?"

  The honest answer was no: the contract states what must be true and how it is verified, not how to build it. Missing were an architectural design for the rewrite, a dependency ordering, and the failing checks themselves as the executable definition of done. All three had to be improvised, including a five-package sequencing analysis showing that one package alone closes 11 of 15 product risks.

  A second consequence surfaced with no guidance from the method: the user chose a hard blocking gate, and it then had to be pointed out that a gate placed on commits would block the very commits that make it green. The gate had to be repositioned to publication. Nothing in the method anticipates that a gate can be self-defeating when the contract is aspirational.

- **Frequency:** Once, but structural to any engagement where quality is defined before the product satisfies it — which is the engagement the method's own philosophy invites.

- **Impact:** The three most valuable pieces of the session for the user's actual next step — the work-package sequencing, the gate-placement reasoning, and the contract-to-implementation handoff — came from outside the method and are recorded nowhere in it.

- **Root cause:** The four modes cover the QA system's lifecycle (discover, design, build the checks, audit the checks). None covers the product's. `QA Build` assumes an existing product that mostly passes: *"Each real failure must become a fixture or regression case when it is stable and within scope."* That sentence describes a maintenance regime, not a rewrite.

### Pattern 7: The harness's own failure modes are not in the mutation catalogue

- **Candidate principle:** A verification system must treat "could not execute" as failure, and the method must require probing the existing suite for silent-skip behaviour.

- **Observation:** The repository's existing browser test exits successfully when no browser is found and when its opt-in environment variable is unset. A gate inheriting that behaviour reports green precisely when it is blind. This became a contract requirement and a registered risk — but it was found by accident, while reading the file for an unrelated reason. `references/mutation-catalog.md` lists six mutation classes, all of them mutations to the *subject* (remove a record, truncate a fixture, cross a threshold, swap an identifier, reuse stale content, fail a dependency during recovery). None mutates the *harness*.

- **Frequency:** Once.

- **Impact:** Positive outcome, obtained by luck. Under a different reading order it would have been missed, and the resulting gate would have had a silent hole of exactly the kind the audit mode exists to find.

- **Root cause:** The mutation catalogue's model is "break the product, expect the check to fail". Its dual — "break the check's prerequisites, expect the run to fail rather than pass" — is absent.

### Pattern 8: Decisive evidence came from the surrounding toolchain, which the method never mentions

- **Candidate principle:** Inspect not only the subject under test but the other tools that operate on the same artifacts, because their defaults constrain what the contract can honestly promise.

- **Observation:** Two decisions were settled by evidence from outside the repository entirely. A configuration default in another editor the user has installed deletes trailing whitespace on save, which is exactly what one candidate answer would have had the product write — making that answer produce content the user's own toolchain destroys. A setting in a third editor showed the user already runs an editor configured never to lose unsaved work, which informed a decision about crash recovery. Both were verified on the machine and against the tool's documentation, not asserted from memory. The user's follow-up question — *"quello che domando come fanno gli editor di testo in questo caso? ad esempio sublime o zed?"* — was itself a request for exactly this class of evidence.

- **Frequency:** Twice in one session, both times decisive.

- **Impact:** Both decisions were made in a single pass, and the user cited the evidence back when choosing. Compare with the abstraction-first questions, which took two cycles and produced a discarded branch.

- **Root cause:** `SKILL.md` scopes inspection to *"the target repository"*. The artifacts under contract usually pass through other tools, and those tools' defaults are part of the environment the contract lives in.

---

## User-Stated Remediation Priority

Six candidate improvements were put to the user during the interview. He ranked
them, unprompted, in this order — and declined to rank two of them:

| Rank | Improvement | Pattern it addresses |
| --- | --- | --- |
| 1 | Reduce the number of questions by deriving what is derivable — several questions in this session were downstream consequences of a single architectural choice | 1 |
| 2 | Distinguish an answer the person authored from one they selected from offered options | 2 |
| 3 | No decision is final until it has been replayed with its consequences | 2 |
| 4 | Order questions so those answerable from the person's lived experience come before those needing the method's vocabulary | 1, 3 |
| — | Explicitly invite rejection of all options, every time | 2 — *not ranked* |
| — | Periodic summary every two or three decisions, with implications | 1 — *not ranked* |

The shape of this ranking matters more than the order itself. The two items the
user declined to rank are both *additional ceremony around the existing questions*.
The four he ranked are all about *having fewer and better-ordered questions in the
first place*. Read together with his diagnosis of the collapse — accumulation, not
any single question — the steer is unambiguous: **reduce the load rather than add
scaffolding to carry it.** An improvement that adds a step to every question cycle
is working against the priority even if it addresses a real defect.

Note that this contradicts one of the two hypotheses put to the user in the
interview. Asked whether the collapse was caused by the option format or by
missing summaries, he chose the option format — and then ranked the summary fix
last. The interviewer's preferred remedy was not the one that mattered.

---

## What Works Well

Do not break these during improvement.

- **The hard barrier on entering the build mode.** *"Never enter QA Build from a proposed, implied, or chat-only approval."* It held under real pressure: the session produced a full contract and stopped. The user's own opening instruction ("don't write tests") and the method's rule reinforced each other rather than competing.

- **The four operating modes as a shape.** Determining the mode from available artifacts, and stating what each mode is allowed to output, kept a long session from drifting into implementation. The mode table is the single most load-bearing part of the instructions.

- **Provenance discipline, in principle.** Recording a source for every conclusion is what made the two mislabelled decisions in Pattern 2 *visible* once their consequences surfaced. The scheme needs a new distinction, but the discipline itself is what makes the flaw detectable at all.

- **Requirement classification.** Forcing every requirement into invariant / threshold / regression / heuristic / experiment / human-decision produced the session's most honest artifact: the single requirement that cannot be automated (the checks run in one browser engine, the product ships on two others) was named as a human decision and marked advisory, rather than being quietly dressed up as a check.

- **"Semantic rubrics only where deterministic checks cannot cover the requirement."** This produced 20 deterministic requirements out of 21, and pushed the one genuine semantic candidate into a better shape: deterministic per fixture inside the gate, with a model used outside the gate purely to discover new fixtures. The instruction's ordering — deterministic first, semantic as a remainder — did real work.

- **The audit philosophy, applied before any code exists.** *"A green suite that does not detect a representative mutation is audit evidence of a QA gap, not a passing result."* This shaped the architecture document's mutation table while the product was still unbuilt, which is earlier and more useful than running it at the end.

- **Maintaining artifacts continuously during Discovery** rather than writing them up at the end. When the user reset the whole model mid-session, the existing decision log made it cheap to mark two decisions superseded and keep everything else.

---

## Open Observations

- **Does the friction change when the person starts with a clear model?** This user said explicitly that his opening request was ambiguous and that his own ideas were not settled: *"la richiesta iniziale era molto ambigua, e probabilmente quando l'ho formulata non avevo le idee molto chiare"*. The method reads as though it is extracting a model the person already holds. Here it was co-constructing one that did not exist yet. Whether the same instructions serve both situations is untested.

- **Did the bundled pilot scenario prime the questioning?** The pilot shipped with the skill describes a Markdown editor whose primary value is preserving user content — nearly identical to this session's real subject. Its suggested opening question is the one that was rejected. It is unclear whether reading it biased the framing toward an axis the user did not care about, or whether the coincidence is incidental. Worth testing against a subject in a different domain.

- **The right number of questions is unknown.** 16 were asked. The user never complained about the count, only about clarity and accumulation. Several were downstream of a single architectural choice and might have been derivable rather than asked — but this was not tested, and fewer questions with less consequence-replay might be worse, not better.

- **How should a superseded decision be presented back to the person?** The `supersedes:` chains are legible in the artifact, but the user was only told in passing that his later answer had tightened an earlier one. Whether an explicit "you changed this, here is what it now means" step would help or would feel like second-guessing was not tested.
