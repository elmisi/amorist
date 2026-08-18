# Takeaway Lessons: qa-architect

**Date:** 2026-07-27 (revised 2026-07-28 after review)
**Evidence:** `takeaway-qa-architect-evidence.md`
**Target scope:** universal

This file contains portable lessons distilled from a usage session. No project-specific names, paths, tools, or metrics appear here by design. For the concrete incidents these lessons were derived from, see the evidence file.

## How strong is this evidence

Everything here comes from **one session, one person, one subject domain, one interaction mode**. Nothing has been replicated across domains. Each lesson therefore carries an explicit strength label:

| Label | Meaning |
| --- | --- |
| `observed-repeatedly` | happened several times within the one session, with no counter-example |
| `observed-once` | a single incident; structural rather than statistical |
| `mechanism-confirmed` | observed here, and the person independently described the same mechanism recurring outside this session |
| `hypothesis` | a proposed explanation that fits the observations but was not itself tested |

**Do not promote a lesson to a requirement of the method on this evidence alone.** The promotion step is: apply the revised method to a subject in a different domain, with a different person, and check whether the lesson's failure mode reappears when the lesson is ignored. A lesson that survives that is a requirement; one that does not is a local preference.

---

## The distinction everything else depends on: three kinds of question

Several rules below say "do not ask" or "must carry a measurement". Applied to every question those rules are wrong, and would forbid a method from asking the things only a person can answer. They apply to one kind of question, so the kinds must be named first.

**Derivable.** The answer is already entailed by a decision taken earlier, or is observable by inspecting or running the subject. → **Must not be asked.** Go and get it. Asking is a debt charged to the person's comprehension with no return.

**Decidable by measurement.** A choice about observable behaviour, where running the subject on inputs that discriminate between the options would show what each option costs. → **May be asked, and must carry those measurements**, expressed in the person's own domain. Asking without them produces a guess.

**Only the person holds it.** Goals, priorities, risk appetite, consent, values, what they will and will not accept, what has actually happened to them, and every normative or strategic choice. No amount of inspection produces these, and demanding a measurement before asking would be both impossible and impertinent. → **Must be asked, early, and no measurement is owed.**

What *is* owed for the third kind: state the consequences of each option as well as they can currently be established, and **record explicitly where a consequence could not be established**. An unmeasurable consequence is a gap in the evidence, not an excuse to present the options as equivalent. Recording the gap is what keeps the decision honest and what tells a later reader which decisions rest on evidence and which rest on preference.

Some questions look like the second kind and are the third: anything where the measurement would be unsafe, would expose private material, or would cost more than the decision is worth. Treat those as the third kind and say why.

---

## Founding Principle

An interview that elicits decisions produces two outputs, not one: the recorded decisions, and the person's own understanding of what they decided. The second is what makes the first trustworthy. A decision the person cannot restate in their own words has not been made, whatever the record says — and a record that cannot tell the difference between a sentence the person composed and a sentence they merely accepted is asserting a confidence it has not earned.

Everything below follows from taking that seriously: ask no *derivable* question, so understanding is not spent on what could have been looked up; ask the ones only the person holds first, while their lived experience is the currency; put measured consequences inside the ones that admit measurement, so the answer is informed; and let a decision harden only after the person has seen what it costs and has said so.

---

## Lessons

### Lesson 1 — Question economy

Every question spends two budgets: the person's time, and their capacity to hold the emerging picture in mind. The second is the scarce one, and it is spent whether or not the question was necessary. Before asking anything, classify it. If it is **derivable** — entailed by a decision already taken, or answerable by inspecting or running the subject — it must not be asked. If it can be **reduced to a smaller question that settles several open points at once**, ask that one instead. A question that is downstream of an architectural choice should not be asked before that choice; once the choice is made, the downstream question often needs no asking at all.

This economy does **not** apply to questions only the person holds. Those are not overhead — they are the point. Asking someone their goals, their priorities or what they will not accept is never comprehension debt, and a method that suppresses them in the name of economy has optimised away its own input.

When a question must be asked, say what it forecloses, so the person can see that answering it removes work rather than adding it.

**General principle:** Never ask a question whose answer is derivable from a prior decision or from the subject's observable behaviour; spend the freed capacity on the questions only the person can answer.
**Evidence strength:** `mechanism-confirmed` — one full collapse in this session, and the person described the same friction recurring across other tools.
**Covers themes:** Pattern 1 (comprehension debt), and the improvement the person ranked first.

### Lesson 2 — Authorship is not assent

A record that marks a conclusion as coming from the person must distinguish two very different events: the person composed the statement, or the person selected it from a set the interviewer composed. These carry different evidential weight and fail in different ways. A selected answer can be the nearest available approximation rather than the intent — offered choices exert pressure toward the closest match, because deviating from a menu costs more effort than accepting it, and because a plausible option invites a quick answer where a blank field would have invited thought.

Provenance schemes therefore need a dimension for authorship, separate from the dimension for confidence. A conclusion the person wrote in their own words is foundational. A conclusion the person picked is provisional until it earns promotion. When a record cannot express that difference, every selected answer silently inherits the authority of a stated one.

**General principle:** Record who authored the wording of a decision, not only who agreed to it; an answer chosen from offered options is weaker evidence than one the person composed, and the record must be able to say which it holds.
**Evidence strength:** `mechanism-confirmed` — two selected answers were revised once their consequences appeared, and the person described the pressure toward the nearest option as a general experience.
**Covers themes:** Pattern 2 (provenance overstated), and the improvement the person ranked second.

### Lesson 3 — Decisions mature through consequence, and silence does not promote them

A decision becomes safe to build on only after the person has seen what it implies **and has said something**. Until then it is a hypothesis with a signature on it. Absence of objection is not agreement: a person who has stopped following, or who is deferring to the interviewer, is silent in exactly the same way as one who agrees.

So the promotion step must be an **event**, not a period of quiet. One of:

- the person **restates** the decision in their own words — the strongest form, and it usually arrives unprompted when the person has genuinely absorbed it; or
- the person is shown a **concrete consequence** and **explicitly affirms** the decision in the light of it.

Nothing else promotes. Not the passage of time, not the decision appearing in a generated artifact the person did not object to, not the interviewer's confidence.

A workable state model, with the transitions that are allowed:

| State | Meaning | How it is entered |
| --- | --- | --- |
| `proposed` | the interviewer put it forward; unanswered | interviewer states an option |
| `selected-provisional` | the person chose it from offered options; the wording is not theirs | person picks |
| `stated-provisional` | the person composed it, but its consequences have not been shown | person writes their own answer |
| `confirmed` | consequences shown, and a promotion event occurred | restatement, or explicit affirmation |
| `superseded` | replaced; carries a pointer to the replacement and the reason | any state, at any time |

Only `*-provisional → confirmed` requires a promotion event; every other transition is mechanical. Nothing may go from `proposed` straight to `confirmed`.

The promotion step is cheap when it is embedded in work that would happen anyway: while pursuing the next question, surface a concrete consequence of the previous answer and let the person revise it. Expect revisions, and treat them as the mechanism working rather than as instability. Design the record so a superseded decision remains visible with the reason it was replaced, rather than being overwritten — the trail is what lets a later reader tell a matured decision from an unexamined one.

**General principle:** A decision is provisional until a promotion event occurs — the person restating it in their own words, or explicitly affirming it after being shown a concrete consequence; silence promotes nothing, and a revision at that point is evidence the method is working.
**Evidence strength:** `observed-once` for the state model itself (it is a design response, not an observation); `observed-repeatedly` for the underlying phenomenon — decisions in this session changed shape each time a consequence was made concrete.
**Covers themes:** Pattern 2 (provenance overstated), and the improvement the person ranked third.

### Lesson 4 — Start where experience can answer

Order questions by what the person can answer from lived knowledge before what requires the method's vocabulary. People can describe their own habits, the state of their own material, what their other tools do to them, and what has gone wrong for them before. They cannot, early on, choose between framings of a problem they have not yet seen stated in concrete terms.

This is the constructive half of Lesson 1. The questions only the person holds are exactly the ones that can be answered from experience, and they belong **first** — not because they are cheap, but because every later measurement is aimed by them. A method that opens with an abstraction has asked the person to aim before they can see.

An abstraction asked first is answered by guesswork or not at all, and worse, it can fix the discussion on an axis the person does not care about — the wrong question answered confidently is more expensive than the wrong question refused. The same abstraction asked later, after concrete answers have accumulated, is often no longer a question at all.

**General principle:** Sequence questions so that early ones draw on the person's direct experience and later ones draw on shared understanding built during the session; never open with a choice between framings.
**Evidence strength:** `observed-repeatedly` — three abstraction-first questions rejected, every evidence-carrying question answered on first presentation, no counter-example in either direction.
**Covers themes:** Patterns 1 and 3, and the improvement the person ranked fourth.

### Lesson 5 — Put measurement inside the question, and name the gap when you cannot

For a question that is **decidable by measurement**, inspecting the subject before asking prevents asking what is already known. That is necessary and not sufficient. The higher-value move is to *execute* the subject on inputs that discriminate between the candidate answers, and put the resulting measurements into the question itself, expressed in the person's own domain rather than the method's.

Extend the inspection beyond the subject to the other tools that operate on the same artifacts. Their defaults constrain what can honestly be promised, and can invalidate a candidate answer outright — an option that produces something a neighbouring tool silently destroys is not a real option. Verify such defaults against the environment and the tool's documentation rather than asserting them from recollection.

**Where measurement does not apply, the obligation changes rather than disappearing.** For a normative, strategic, consent-related or otherwise unexecutable choice — and for one where measuring would be unsafe, would expose private material, or would cost more than the decision is worth — the rule is: present the strongest evidence actually available, and **record the evidence gap explicitly against the decision**. Never manufacture a measurement to satisfy the form of the rule; a fabricated number is worse than an acknowledged gap, because it is indistinguishable from a real one later.

There is a diagnostic here too: if a question is not answered on its second presentation, the problem is usually the axis rather than the wording. Rewriting the same choice more clearly wastes another cycle. Go get a measurement instead, or ask what the person would measure.

**General principle:** A question decidable by measurement must carry the measured consequence of each option, produced by running the subject and inspecting the tools around it; where measurement is infeasible or inappropriate, carry the best grounded evidence available and record the gap — and read a repeated non-answer as the wrong axis rather than poor wording.
**Evidence strength:** `observed-repeatedly` — every question that carried evidence was answered immediately; the surrounding toolchain supplied decisive evidence twice.
**Covers themes:** Patterns 3 and 8.

### Lesson 6 — Two registers, kept apart

Artifacts need short identifiers so they can cross-reference each other. People need self-explanatory language. These are two registers and they must not mix: an identifier that exists for machine or document cross-referencing has no meaning to the person and, when it appears in text addressed to them, it silently transfers the cost of decoding the artifact onto the reader.

The same separation applies to the method's own vocabulary. Terminology that names concepts inside the discipline is a shorthand between practitioners, not a shared language with the person whose product is being discussed. In conversational text, describe the thing; in artifacts, name it.

**General principle:** Identifiers and internal terminology exist for artifacts, not for people; text addressed to a person must be readable without opening any artifact.
**Evidence strength:** `observed-repeatedly` — recurring until explicitly corrected, then absent.
**Covers themes:** Pattern 4.

### Lesson 7 — Every named artifact ships with a schema

A method that instructs an agent to maintain an artifact must define that artifact's shape. Without a schema the structure is invented per session: identifiers become inconsistent, entries land in the wrong section, and the result cannot be reliably consumed by a different agent or compared across runs. The artifacts of the earliest phase are the most exposed, because they are created while the picture is least stable and they are the ones a later phase depends on.

Two fields are not obvious until a session needs them:

- **Supersession** — a way to mark a record as replaced, with a pointer to what replaced it and why. Any method where conclusions can be revised — which is any method worth using — needs this as a first-class part of the schema rather than an improvisation.
- **Provenance**, with authorship and state as separate dimensions from confidence. The values must be enumerated in the schema itself, not left to each agent's interpretation: two agents that both write "confirmed" while meaning different things produce a record that is worse than one with no provenance at all, because it looks trustworthy.

The minimum a provenance record must carry: who authored the wording (`composed` / `selected` / `inferred-and-confirmed`); the decision state and its allowed transitions (Lesson 3); the basis (`measurement` / `prior-decision` / `person's-experience` / `person's-preference` / `interviewer-recommendation`); and the evidence gap, required whenever the basis is not measurement for a question that was decidable by measurement.

**General principle:** Provide a schema for every artifact the method names, enumerate the provenance and state values inside it rather than leaving them to interpretation, and include first-class supersession, since revision is normal rather than exceptional.
**Evidence strength:** `observed-once`, structural — one class of malformed artifact, plus the general observation that the least-defined artifacts are the ones everything downstream reads.
**Covers themes:** Pattern 5.

### Lesson 8 — A specification is not a description

A quality contract can describe a system that does not exist yet. When most of its requirements fail on the day it is signed, the method is no longer gating maintenance work — it is specifying a build. That situation changes three things the method must address explicitly.

First, gate placement. A gate that blocks the work required to satisfy it is self-defeating, and the person choosing "block everything" is usually choosing strictness rather than that specific consequence. Place the gate where it protects the outside world without obstructing the remedy, and say so when the choice is made.

Second, ordering. When requirements fail in bulk, they do not fail independently: one structural change typically closes most of them. Identify that dependency structure and state it, because the difference between a sequenced rewrite and a list of unrelated fixes is the difference between finishing and not.

Third, the handoff. A contract states what must be true and how it is verified — never how to build it. Anyone proceeding from an approved contract to implementation still needs the failing checks as the executable definition of done, a design for the change, and the ordering above. A method that stops at the contract should say plainly that these are missing, rather than letting the contract's completeness imply the work is specified.

**General principle:** State what changes when the contract specifies a system yet to be built: where the gate must sit so it does not block its own remedy, what the dependency order among failing requirements is, and what a person still needs beyond the contract in order to implement it.
**Evidence strength:** `observed-once`, structural — but structural to any engagement where quality is defined before the product satisfies it, which is the engagement this kind of method invites.
**Covers themes:** Pattern 6.

### Lesson 9 — Mutate the harness, and keep its failures separate from the product's

Mutation testing conventionally breaks the subject and expects a check to fail. Its dual is equally important and usually missing: break the *check's prerequisites* and expect the run to fail rather than to pass. A verification system that reports success when it could not execute — a missing runtime dependency, an unreadable set of sample inputs, an unset opt-in flag, a build that never completed — is worse than no verification, because it manufactures confidence.

But "not a pass" is not enough on its own. **A failing product and a broken harness need separate statuses**, because they have different causes, different fixes and different owners:

| Status | Meaning | Whose problem |
| --- | --- | --- |
| `requirement-failure` | the check ran and the subject did not satisfy it | whoever builds the subject |
| `harness-failure` | the check could not run: prerequisite, environment, or build | whoever maintains the verification system |
| `coverage-gap` | declared in the specification, not exercised by any check | whoever maintains the verification system |

All three must prevent a green result. Collapsing them into one hides which of two very different repairs is needed, and sends the report to the wrong person. The distinction has to survive into the reported output, not merely exist in the runner's internals: a harness failure whose message names only the symptom is barely better than one that passes silently.

Make this a standing requirement of any verification system, and a standing item in the audit: inspect the existing suite for silent-skip behaviour, since inherited harness conventions are a common source of it.

**General principle:** A check that cannot execute is a failure, never a pass — and it is a different kind of failure from an unmet requirement; both block a green result, and the report must say which it is holding.
**Evidence strength:** `observed-once` for the silent-skip instance found in the subject's own suite; `hypothesis` for the claim that inherited harness conventions are a common source of it.
**Covers themes:** Pattern 7.

---

## Meta-Observations

**Option menus may be approximation-accepting devices.** `hypothesis`. Whenever a system offers a person a closed set of choices, answers may drift toward the nearest option rather than the true intent, because deviating costs more effort than accepting. The person in this session described exactly that experience, across tools and not only this one — which makes it well-motivated, but it remains one person and one interaction mode. Two claims are bundled here and should be separated: that *this* person's selected answers were weaker evidence than their composed ones (observed, and the safeguard in Lesson 2 stands on it alone), and that this is a general property of option interfaces (untested).

A way to test the second without another full session: present the same decision to different people in two forms — a closed set of options, and an open prompt with the same information — and compare the answers to what those people say when the consequences are later made concrete. **Keep the provenance safeguard regardless of the outcome**: it is justified by the first claim, which is the one that was observed.

**The measure of a question is the clarity it leaves behind, not the information it extracts.** A question that yields an answer while leaving the person less oriented than before has a negative return, and the debt is invisible at the time because the answer arrived. Optimise the sequence for the person's understanding at each step, not for the completeness of the record.

**A person's spontaneous restatement outranks many extracted answers.** When someone stops and says the thing in their own words, that statement is better evidence than a long chain of selected ones, and it is often the point where the real requirements first appear. Make room for it early and deliberately rather than waiting for it to arrive as a symptom of collapse.

**Ranking of proposed remedies is itself evidence, and its shape carries more than its order.** When a person ranks improvements, notice what they decline to rank. A pattern of rejecting every remedy that adds a step, while accepting every remedy that removes one, is a statement about the cost structure they are experiencing — and it may contradict the interviewer's own diagnosis. Record the ranking with its provenance and let it override the interviewer's preferred fix.

---

## Discarded as Too Specific

- Domain of the subject under review and every construct-level detail of its content format — the principle survives in Lesson 5 (measurement inside the question); the specific constructs do not transfer.
- Names of the neighbouring tools whose configuration defaults settled several questions, and the names of those settings — the transferable rule is in Lesson 5; the specific defaults are an artifact of one person's setup.
- All session counts and ratios (questions asked, requirements failing, decisions revised, files exhibiting a property) — snapshots of one instance. Where magnitude mattered it is restated as a principle: "most requirements failing on day one" in Lesson 8, "repeated non-answers" in Lesson 5. Counts appear in the evidence-strength labels only as coarse categories, never as figures.
- Requirement, decision and risk identifiers from the session's artifacts — Lesson 6 exists precisely because these should not travel.
- The specific structural syntax errors produced while hand-authoring structured data, and the format they occurred in — an incident, not a principle; the transferable part is schema provision in Lesson 7.
- The particular runtime discrepancy between where the checks execute and where the product ships — a real coverage hole, but its portable content is already carried by Lesson 9 and by the general practice of naming the limits of a verification rather than hiding them.
- The bundled example scenario whose suggested opening question was rejected in practice — kept in the evidence file as an open observation, because it is a defect in one specific asset rather than a portable lesson.
- The five-package sequencing analysis produced for the subject — the reusable content is the instruction to identify dependency structure among failing requirements (Lesson 8); the packages themselves belong to one product.

---

## Open Questions (Architectural)

1. ~~**Is eliciting an existing model the same activity as co-constructing one that does not exist yet?**~~ **Settled: always assume co-construction.** `composed`, `confirmed`.

   A method written for elicitation asks the person to choose between framings; one written for co-construction builds the framings from measurements first and offers the choice last. Detecting which situation applies is not viable: the only available detector is asking, and that question is unreliable in exactly the case that matters — a person without a settled model often does not know they lack one, and may open with a request that sounds precise.

   The asymmetry was expected to be *cost of error is low in one direction*. The person corrected that: **the concrete-first path pays even when the model is already clear.** In their words, someone with settled ideas simply moves through the concrete questions faster, and — from their experience, not from this session — there is always some aspect they had not considered, which the questions surface while there is still room to think about it. So the second branch is not a tolerable waste; it is a second reason to take the same path.

   This closes the branch rather than choosing between two live options: there is one procedure, and it starts from what the subject does today rather than from what quality means.

2. ~~**Should provisional decisions be allowed to flow into generated artifacts?**~~ **Settled: yes, marked as provisional — and the approval step is the promotion event.** `composed`, `confirmed`.

   Artifacts are written continuously during the interview, so a provisional decision reaches paper within minutes of being taken. Withholding them until every decision matures would stall the work and destroy the continuous-artifact practice, which is what makes a mid-session reset cheap. So provisional decisions flow, carrying their state.

   The method already has one moment where everything must mature in bulk — the approval that separates specification from construction — and it sits exactly on the boundary where revision stops being cheap. Before it there is only text; after it there is built work. That is the promotion event, and it needs no new ceremony because it already exists.

   **What must change is what happens there. The approval step must present the consequences, not request a signature.** Asking "do you approve?" after a long document collects silence and calls it consent, which Lesson 3 forbids. Evidence that this is not theoretical: in this session the approval step put the open points and the current pass/fail position in front of the person, and one of those points was revised at that moment rather than confirmed — a revision that cost minutes there and would have cost roughly half the built apparatus a week later. Same revision; different amount already built on top of it.

   **No maximum on how much is presented.** The person rejected a cap in favour of a sufficiency condition: enough to reach full agreement between what they and the project need, and what the specification says. Two consequences follow. The step ends on a condition, not on a quota — so it may be one item or twenty. And the condition is one only the person can evaluate, so the interviewer may not declare the step finished; it ends when the person says the gap is closed. Note also that they named two sources of requirement, their own needs *and* the project's, which are not always the same thing.

3. ~~**Where does the method's boundary sit when the contract specifies work that has not been done?**~~ **Settled: the method never crosses into implementation — it goes deeper on its own side instead.** `composed`, `confirmed`.

   The question was posed as a choice between owning the handoff (sequencing and design) and disclaiming it. The person rejected both framings and supplied a third: the method stays entirely within verification, and when the reader needs more, the answer is **more requirements and finer checks**, not a plan.

   Three outputs follow, all of them inside the discipline:

   - **Guide checks.** Finer-grained checks than gating requires — deliberately redundant, in the person's own words, because a check subsumed by a coarser one is still the cheapest possible statement of a sub-behaviour, and it tells whoever is building exactly which step is wrong while they are building it. They are development guidance expressed as verification, which is the only currency the method is allowed to pay in.
   - **Constraints entailed by the results.** Not plans — *exclusions*. When measurement shows that no change confined to one part of the system can satisfy a requirement, that is a fact about the requirement, produced by verification, and it belongs in the report. It narrows the search without designing anything.
   - **Grouping by shared symptom.** Requirements whose failures the report describes identically are visibly one problem, and saying so costs a query rather than a question. Where a shared cause is only visible to someone who has read the product, the method must say that it is inferring, not reporting.

   **The guardrail this needs, or it becomes the very thing it forbids:** a guide check must assert *observable behaviour*, never internal structure. The moment a check names a function, a field or an intermediate representation, it has stopped specifying what must be true and started prescribing how to build it — implementation smuggled in wearing a test's clothes, which is exactly the boundary the person drew. Redundancy is also not free: guide checks are more surface to maintain, and inside the gate they multiply noise. They belong outside the gate, and they may be retired once the coarse requirement they were scaffolding for is green.

4. ~~**How much should the method invest in the earliest phase's artifacts versus the final ones?**~~ **Settled: a minimal skeleton, fixing structure and nothing about content.** `composed`, `confirmed`.

   The later phase's artifacts have templates; the earliest phase's are only named, so their shape is invented per session. After the first question above, that phase is the one always doing construction — it carries the whole model and has no defined form.

   The failures observed were all **structural, never about content depth**: a record appended into the wrong section of its own file, caught only by a validity check; identifiers assigned by hand, leaving gaps and one pair out of order; supersession expressed through fields invented on the spot and inconsistent between uses. The content of those records was fine. The box was missing.

   So the skeleton fixes exactly four things and stops: an identifier assigned mechanically rather than by hand, what the record answers, provenance and state, and supersession. Nothing constrains what may be written inside. That leaves the phase as fluid as it needs to be while making every record findable, citable and formally replaceable — which is the whole of what went wrong.

   **Note on the ceremony budget:** this changes a file format, not the conversation, so it adds nothing to the question cycle. Under the budget rule it is out of scope — and the rule requires that to be stated rather than quietly assumed, which is why it is stated here.

5. ~~**Who classifies a question, and what happens when the classification is wrong?**~~ **Settled: the interviewer classifies, and owes a consolidated list of everything decided without asking.** `composed`, `confirmed`.

   The two misclassification errors are not symmetric. Treating a derivable question as the person's wastes one question, and the person catches it immediately. Treating a question only the person holds as derivable means the interviewer answers it alone and **never asks** — and the person cannot catch what they were never shown. Only the second needs a safeguard.

   Two safeguards were considered: declaring the classification inside each question, which costs a clause on every question asked; or recording each skipped question where it occurs. The person chose neither exactly, and specified the mechanism rather than accepting one: **a single consolidated list, presented in one pass, of everything the interviewer concluded without asking.** Their stated purpose is not documentation — it is *"so that it can raise a doubt in me"*. That is a different artifact from a log: it is written to be scanned for surprises, and entries scattered through a document are read past precisely when they matter.

   Where it goes: the approval step, which already exists, already presents consequences, and already has the person in a reviewing posture. No new step, so the ceremony budget is untouched.

   What it must contain, per entry: the question that was not asked, the answer assumed, and what it was derived from. The last field is what makes a wrong entry visible — a conclusion drawn from a configuration file rather than from the person is exactly the kind that looks solid and may rest on nothing.

---

## Agent Instructions

Process rules for an agent improving this target. Each derives from a lesson above.

1. Add the three-kinds classification to the method as a required step before any question is asked: derivable, decidable by measurement, or only the person holds it. Every rule below that constrains questioning applies to a named subset of the three, never to all questions.
2. Before adding any **decision question about the subject's observable behaviour** to the method's flow, require it be justified as non-derivable: not entailed by a prior decision, not answerable by executing the subject, not reducible to a broader question that settles several points at once. Prefer removing such questions to adding scaffolding around them. Do **not** apply this test to questions about goals, consent, priorities, values or the person's direct experience — those must have a defined path that requires them to be asked, and asked early.
3. Extend the provenance scheme with a dimension that records authorship separately from confidence, distinguishing a statement the person composed from one they selected among offered options.
4. Specify, in the method itself and not per agent, the enumerated provenance values, decision states, allowed transitions and required fields. At minimum: authorship (`composed` / `selected` / `inferred-and-confirmed`); state (`proposed` / `selected-provisional` / `stated-provisional` / `confirmed` / `superseded`); basis (`measurement` / `prior-decision` / `person's-experience` / `person's-preference` / `interviewer-recommendation`); and an evidence-gap field, required whenever the basis is not measurement for a question that was decidable by measurement. Without enumeration, separate agents will implement incompatible meanings of the same word.
5. Define the promotion event explicitly and forbid promotion by silence: a provisional decision becomes confirmed only when the person restates it in their own words, or explicitly affirms it after being shown a concrete consequence. Embed the replay in work already happening rather than adding a dedicated step.
6. Add supersession to every artifact schema — a way to mark a record as replaced, by what, and why — and treat revision as expected behaviour rather than an exception.
7. Require question sequencing to place those answerable from the person's direct experience before those needing the method's own vocabulary, and forbid opening with a choice between framings of the problem.
8. Require that a decision question **about observable behaviour** carry measurements produced by executing the subject on discriminating inputs, expressed in the person's domain. Extend the prescribed inspection scope from the subject alone to the tools that operate on the same artifacts, and require such external behaviour to be verified rather than recalled. Provide an explicit exception: where a choice cannot be executed, or measuring would be unsafe, privacy-invading or disproportionate, require the strongest available grounded evidence and a recorded evidence gap instead. Never fabricate a measurement to satisfy the form of the rule.
9. Add a diagnostic rule: a question not answered on its second presentation indicates the wrong axis, not poor wording — the response is to obtain a measurement or ask what the person would measure, never to reword the same choice a third time.
10. Separate the register used in artifacts from the register used with people: internal identifiers and discipline-specific terminology must not appear in text addressed to the person.
11. Provide a schema for every artifact the method names, with the earliest phase's artifacts held to the same standard as the final ones.
12. Add explicit handling for the case where the specification describes a system that does not yet exist: gate placement that does not obstruct the remedy, identification of the dependency order among failing requirements, and a statement of what a reader still needs beyond the specification in order to implement it.
13. Extend the mutation set with prerequisite sabotage, and require the verification system to distinguish `requirement-failure`, `harness-failure` and `coverage-gap` as separate reported statuses, all of which block a green result. Require an audit of the existing suite for skip-and-succeed behaviour.
14. Review the bundled example material against these rules — an example that models a question the method should no longer ask will reproduce the defect in every session that reads it.

Constraints the improving agent must respect:

- Do not weaken the barrier that forbids entering the implementation phase without an explicit, recorded approval. It held under pressure in this session and is the method's most load-bearing rule.
- Do not remove the phase structure or the statement of what each phase is permitted to output. It is what keeps a long session from drifting into premature implementation.
- Do not remove the requirement to classify each requirement by kind, nor the ordering that prefers deterministic verification and admits model-based judgement only as a remainder. Both produced measurably better artifacts in this session.
- Do not remove the audit principle that a passing suite which fails to detect a representative mutation is evidence of a gap rather than a result.
- Preserve the practice of maintaining artifacts continuously during the interview rather than writing them up at the end; it is what made a mid-session reset cheap to absorb.
- **Ceremony budget, enforced by a ledger rather than by intention.** The unit is *mandatory interviewer actions per question cycle*: steps the method obliges the interviewer to perform for each question asked. Any change proposal that raises that count must name, in the same proposal, the specific action it removes or automates to pay for it, and state the count before and after. A proposal that cannot name its payment is rejected. Changes that add optional guidance, or that add a step to the session as a whole rather than to each question cycle, are outside the budget and must say so explicitly rather than being quietly exempted. The person's ranking in this session rejected every remedy that added a step and accepted every remedy that removed one; this ledger is what stops that preference from being eroded one reasonable-looking addition at a time.
- Validation criterion, without re-running the original session: apply the revised method to a subject in a different domain and check that **no decision question about observable behaviour** is asked before a measurement has been offered on the same topic; that questions about goals, consent, priorities and direct experience *are* asked, and asked before the abstractions; that every recorded conclusion states whether it was composed or selected and whether it has been confirmed by an event rather than by silence; that every unmeasured consequence carries a recorded evidence gap; and that no text addressed to the person contains an identifier defined only inside an artifact.
