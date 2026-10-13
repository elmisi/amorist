# Takeaway Lessons: qa-architect

**Date:** 2026-07-27 (revised 2026-07-28 after review; extended 2026-07-29 after the construction phase; annotations processed 2026-07-30)
**Evidence:** `takeaway-qa-architect-evidence.md`
**Target scope:** universal

This file contains portable lessons distilled from a usage session. No project-specific names, paths, tools, or metrics appear here by design. For the concrete incidents these lessons were derived from, see the evidence file.

## How strong is this evidence

Everything here comes from **one engagement, one person, one subject domain, one interaction mode**. Nothing has been replicated across domains. Each lesson therefore carries an explicit strength label.

Lessons 1 to 9 come from the interview and specification phases. Lessons 10 to 12 come from the construction and reporting phases that followed, and they fail in different ways: the earlier ones are about a person's understanding, the later ones about whether a verification is worth anything. Both halves sit on the same axis — see the Founding Principle.

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

**Informed by measurement.** A choice with observable consequences, where running the subject on inputs that discriminate between the options would show what each option costs. → **May be asked, and must carry those measurements**, expressed in the person's own domain. Asking without them produces a guess.

The name of this kind matters more than it looks. Measurement does not *decide* such a question; it prices the options, and someone still has to choose between the prices. Calling the kind "decidable by measurement" invites the interviewer to settle a trade-off by producing a number — which is a question of the third kind, answered by the wrong party, wearing a number as authority.

**Only the person holds it.** Goals, priorities, risk appetite, consent, values, what they will and will not accept, what has actually happened to them, and every normative or strategic choice. No amount of inspection produces these, and demanding a measurement before asking would be both impossible and impertinent. → **Must be asked, early, and no measurement is owed.**

What *is* owed for the third kind: state the consequences of each option as well as they can currently be established, and **record explicitly where a consequence could not be established**. An unmeasurable consequence is a gap in the evidence, not an excuse to present the options as equivalent. Recording the gap is what keeps the decision honest and what tells a later reader which decisions rest on evidence and which rest on preference.

Some questions look like the second kind and are wholly the third: anything where the measurement would be unsafe, would expose private material, or would cost more than the decision is worth. Treat those as the third kind and say why.

### The kinds classify parts of a question, not whole questions

The three are prompts for taking a question apart, not a set of boxes to sort it into. A real decision usually contains all three at once: some of what it turns on is already entailed by an earlier decision, some of it would be settled by running the subject, and what remains is a preference nobody but the person can supply. Forcing such a question into a single category produces both failure modes simultaneously — the person is asked to supply a fact they could not know, and the interviewer quietly decides a preference that was never theirs.

So the interviewer's obligation is to **split the question and treat each part by its own rule**: fetch the derivable part rather than asking it, price the observable part by running the subject, and put to the person only the part that is genuinely theirs — with the other two already in hand and stated. A question arriving in that shape is short, and it is the only shape in which the person's answer is both informed and actually theirs.

Splitting is not an additional step in the cycle. It is what classifying *produces*: the output of the classification is a list of parts with a kind each, and one part is often empty. Where the parts would receive identical treatment there is nothing to split and the classification emits a single label.

---

## Founding Principle

An interview that elicits decisions produces two outputs, not one: the recorded decisions, and the person's own understanding of what they decided. The second is what makes the first trustworthy. A decision the person cannot restate in their own words has not been made, whatever the record says — and a record that cannot tell the difference between a sentence the person composed and a sentence they merely accepted is asserting a confidence it has not earned.

Everything below follows from taking that seriously: ask no *derivable* question, so understanding is not spent on what could have been looked up; ask the ones only the person holds first, while their lived experience is the currency; put measured consequences inside the ones that admit measurement, so the answer is informed; and let a decision harden only after the person has seen what it costs and has said so.

**The same axis governs the second half of the work, and it is easy to miss.** A record must be able to say how much it knows; so must a check, and so must a report. A check that has never been shown capable of failing is asserting a confidence it has not earned, exactly as a decision recorded as agreed when it was only selected. A report that describes what was meant to run rather than what ran is doing the same thing one level up. The interview phase and the construction phase fail differently and for the same reason: something claims to know more than it does, and nothing in the method makes the claim state its own basis.

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
| `inferred-provisional` | the interviewer concluded it without asking; the person has not yet seen it | interviewer answers a derivable part instead of asking it |
| `confirmed` | consequences shown, and a promotion event occurred | restatement, or explicit affirmation |
| `superseded` | replaced; carries a pointer to the replacement and the reason | any state, at any time |

Only `*-provisional → confirmed` requires a promotion event; every other transition is mechanical. Nothing may go from `proposed` straight to `confirmed`.

**A conclusion the interviewer reached instead of asking enters as provisional too, and this is the hole worth closing deliberately.** Answering rather than asking is not only permitted but required for the derivable part of a question — otherwise the method is charging the person for what it could have looked up. What must not follow is the conclusion arriving in the record already mature. It enters with authorship `inferred` and state `inferred-provisional`, and it is promoted by the same class of event as anything else: the person sees the conclusion **together with what it was derived from**, and affirms or revises it. The consolidated list of unasked questions presented at approval is the natural occasion. An inferred conclusion the person never responds to remains provisional and must be reported as provisional — otherwise the prohibition on promotion by silence has an opening at precisely the point where the interviewer, rather than the person, did the deciding.

Note what is being kept apart here. `inferred` is an authorship value; `confirmed` is a state. A single fused label — "inferred and confirmed" — reads as one thing and hides the transition between two, which is the exact conflation Lesson 2 exists to prevent.

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

For a question with a part that is **informed by measurement**, inspecting the subject before asking prevents asking what is already known. That is necessary and not sufficient. The higher-value move is to *execute* the subject on inputs that discriminate between the candidate answers, and put the resulting measurements into the question itself, expressed in the person's own domain rather than the method's.

Extend the inspection beyond the subject to the other tools that operate on the same artifacts. Their defaults constrain what can honestly be promised, and can invalidate a candidate answer outright — an option that produces something a neighbouring tool silently destroys is not a real option. Verify such defaults against the environment and the tool's documentation rather than asserting them from recollection.

**Where measurement does not apply, the obligation changes rather than disappearing.** For a normative, strategic, consent-related or otherwise unexecutable choice — and for one where measuring would be unsafe, would expose private material, or would cost more than the decision is worth — the rule is: present the strongest evidence actually available, and **record the evidence gap explicitly against the decision**. Never manufacture a measurement to satisfy the form of the rule; a fabricated number is worse than an acknowledged gap, because it is indistinguishable from a real one later.

There is a diagnostic here too: if a question is not answered on its second presentation, the problem is usually the axis rather than the wording. Rewriting the same choice more clearly wastes another cycle. Go get a measurement instead, or ask what the person would measure.

**General principle:** Where a question has a part that measurement can price, it must carry the measured consequence of each option, produced by running the subject and inspecting the tools around it; where measurement is infeasible or inappropriate, carry the best grounded evidence available and record the gap — and read a repeated non-answer as the wrong axis rather than poor wording.
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

The minimum a provenance record must carry: who authored the wording (`composed` / `selected` / `inferred`); the decision state and its allowed transitions (Lesson 3); the basis on which it rests; and an evidence gap where one exists.

**A schema must fix cardinality as well as values, and the basis field is where this bites.** A decision commonly rests on several things at once — a measured cost, an earlier decision it follows from, and the person's preference between the priced options — which is not a defect but the normal shape of a well-made decision. A field that admits one mutually exclusive value forces the record to hide all but one of them, and what gets hidden is usually the measurement, because the preference is what the person said last. So enumerate the values (`measurement` / `prior-decision` / `person's-experience` / `person's-preference` / `interviewer-recommendation`), allow more than one, and require at least one.

**An evidence gap means a measurement that was owed is missing** — the question had a part measurement could have priced, and it was not priced. It does not mean the decision also rests on something other than measurement. Confusing the two ruins the field in both directions: recorded against every decision that carries a preference, it marks almost everything and therefore means nothing; omitted because "the person had a preference anyway", it conceals the one fact worth recording, which is that the preference was uninformed.

**General principle:** Provide a schema for every artifact the method names, enumerate the provenance and state values inside it rather than leaving them to interpretation, and include first-class supersession, since revision is normal rather than exceptional.
**Evidence strength:** `observed-once`, structural — one class of malformed artifact, plus the general observation that the least-defined artifacts are the ones everything downstream reads.
**Covers themes:** Pattern 5.

### Lesson 8 — A specification is not a description

A quality contract can describe a system that does not exist yet. When most of its requirements fail on the day it is signed, the method is no longer gating maintenance work — it is specifying a build. That situation changes three things the method must address explicitly.

First, gate placement. A gate that blocks the work required to satisfy it is self-defeating, and the person choosing "block everything" is usually choosing strictness rather than that specific consequence. Place the gate where it protects the outside world without obstructing the remedy, and say so when the choice is made.

Second, dependency among the failures — **reported, never prescribed**. When requirements fail in bulk they rarely fail independently, and saying so is worth a great deal to whoever has to fix them. But there is a line here, and it is the one drawn under Open Question 3: what the method may state is what verification demonstrates — requirements whose failures present the same symptom, and constraints its own measurements entail, such as a requirement no change confined to one part of the system can satisfy. Each such statement must say whether it is observed or inferred by someone who has read the product. What the method may **not** do is convert that into a build order. Grouping by shared symptom and naming the constraints the results entail stays inside verification; a sequence of steps to follow does not, however useful it would be, and however similar the two documents look on the page.

Third, the handoff. A contract states what must be true and how it is verified — never how to build it. Anyone proceeding from an approved contract to implementation still needs the failing checks as the executable definition of done, a design for the change, and a build order. The method supplies the first, may supply the dependency facts above, and supplies neither of the last two. It should say so plainly, rather than letting the contract's completeness imply the work is specified.

**General principle:** State what changes when the contract specifies a system yet to be built: where the gate must sit so it does not block its own remedy, which failing requirements verification shows to be one problem rather than several, and what a person still needs beyond the contract — and will not get from it — in order to implement it.
**Evidence strength:** `observed-once`, structural — but structural to any engagement where quality is defined before the product satisfies it, which is the engagement this kind of method invites.
**Covers themes:** Pattern 6.

### Lesson 9 — Mutate the harness, and keep its failures separate from the product's

Mutation testing conventionally breaks the subject and expects a check to fail. Its dual is equally important and usually missing: break the *check's prerequisites* and expect the run to fail rather than to pass. A verification system that reports success when it could not execute — a missing runtime dependency, an unreadable set of sample inputs, an unset opt-in flag, a build that never completed — is worse than no verification, because it manufactures confidence.

But "not a pass" is not enough on its own. **A failing product and a broken harness need separate statuses**, because they have different causes, different fixes and different owners:

| Status | Meaning | Whose problem |
| --- | --- | --- |
| `requirement-failure` | the check ran and the subject did not satisfy it | whoever builds the subject |
| `harness-failure` | the check could not run: prerequisite, environment, or build | whoever maintains the verification system |
| `coverage-gap` | expected to be exercised automatically, and nothing exercises it | whoever maintains the verification system |

All three must prevent a green result. Collapsing them into one hides which of two very different repairs is needed, and sends the report to the wrong person. The distinction has to survive into the reported output, not merely exist in the runner's internals: a harness failure whose message names only the symptom is barely better than one that passes silently.

A fourth status is what keeps the third honest:

| Status | Meaning | Whose problem |
| --- | --- | --- |
| `declared-unautomated` | the specification says this is not verified by machine, and says how it is evidenced instead | whoever approves the specification |

Some requirements genuinely cannot be decided by a machine — a judgement about taste, a review that needs a human witness, an obligation discharged by a person signing something. Applying `coverage-gap` to those makes an honest requirement block a green result permanently, and the pressure then lands in the worst possible place: sooner or later someone writes a check that pretends to measure it, which is how a suite acquires its most convincing lie.

So allow the specification to declare a requirement unautomated, and make the declaration cost something: a stated reason, a stated route by which the requirement *is* evidenced, and a named owner of that route. Two guardrails, and neither is optional. The escape must be a **declaration in the specification, approved as such** — never a property the runner infers when it finds nothing to run, which would recreate the silent skip inside the very mechanism built to abolish it. And a declared-unautomated requirement, although it does not block green, must appear in **every** report with its count, because a verification that never mentions the part of the specification it does not cover is making exactly the coverage claim Lesson 12 forbids.

Make this a standing requirement of any verification system, and a standing item in the audit: inspect the existing suite for silent-skip behaviour, since inherited harness conventions are a common source of it.

**General principle:** A check that cannot execute is a failure, never a pass — and it is a different kind of failure from an unmet requirement; both block a green result, and the report must say which it is holding. The only thing that may be exercised by no check is a requirement the specification declares unautomated, with its reason, its alternative route and its owner — a decision taken in the specification and visible in every report, never one the runner reaches on its own.
**Evidence strength:** `observed-once` for the silent-skip instance found in the subject's own suite; `hypothesis` for the claim that inherited harness conventions are a common source of it.
**Covers themes:** Pattern 7.

### Lesson 10 — Making it checkable narrows it; compare back to the words

Turning a stated intent into a condition a machine can decide pulls it toward what is easy to decide. Nothing pulls the other way. The result is a requirement that is a subset of what the person meant — and the loss is well disguised, because it arrives dressed as rigour.

The disguise gets help from the format. A requirement template with somewhere to record exceptions will attract the narrowing into that field, where it reads as a considered trade-off rather than as a piece of the intent being dropped. A reviewer then sees an exception that someone thought about, and approves it. The narrowing can survive the approval step for that reason, even an approval step that presents consequences properly.

Two defences, and the second is cheaper than the first:

- After a requirement is written, **compare it back against the person's own words**, and state what the checkable version does not cover. If nothing was dropped, say so; the value is in the comparison being performed, not in its usual outcome.
- **Show the person the material the check will run on**, not only the requirement. Sample inputs are a legible statement of scope — how large, how messy, how many — and none of that appears in a requirement's text. A person who would read past an exception clause in a specification will look at three small samples and say *that is not the size of thing I meant*.

**General principle:** After making a requirement checkable, compare it back against the words it came from and show the person the material it will be checked against; operationalisation loses intent, and it disguises the loss as rigour.
**Evidence strength:** `observed-once`, structural — found on one requirement because the person noticed, with no systematic comparison run on the others, so the base rate is unknown.
**Covers themes:** Patterns 9 and 10.

### Lesson 11 — A check that runs is not yet a check

An earlier lesson requires that a check unable to execute must fail rather than pass. That covers absence. It does not cover the harder case: a check that runs, has everything it needs, produces a verdict, and is not measuring the subject. Three distinct shapes, all observed:

- **Aimed at material where the property holds trivially.** The check reports a pass, and the pass is about the material rather than the subject.
- **Failing for reasons internal to itself.** It never reaches the property at all. While the subject is also broken this is indistinguishable from a working check — it fails, the count looks right, and nobody reads the message.
- **Insufficient power to discriminate.** The comparison it makes would report agreement for a wrong answer as well as a right one. This one is the most dangerous because it is *latent*: while the subject fails badly the check fails too, and it begins passing wrongly at exactly the moment the subject starts improving — which is when a check stops being watched.

So before trusting a check, answer two questions: **what would make this pass while the subject is broken**, and **what would make it fail for reasons of its own**. How much evidence those answers need depends on what the check compares, and the method should say so rather than demanding the same proof everywhere. Where equality of the whole artifact is asserted, a wrong answer cannot compare equal and stating why is enough. Where a threshold is applied to a measured quantity, what is owed is the threshold's relation to that measurement's own noise. Where the comparison is partial — a token, a fragment, a summary — nothing short of measurement will do: measure how often it would agree by chance over the material it will run on, because in exactly that class the failure mode is that the reasoning sounds right. If a wrong answer would usually look right, the comparison is the wrong one — anchor it to something that cannot collide.

Two habits do most of the work here. **Ask why something passed**, not only why something failed; two of the three shapes above are invisible to any amount of failure analysis. And **read the failure text, not the failure count** — a check failing for its own reasons has a perfectly healthy-looking count.

Finally, a verdict should carry **the scale of what produced it**: how much was looked at. Without it nobody can judge whether a passing check looked at enough, and the question cannot be answered later without re-deriving it from scratch. Evidence is conventionally required for failures; this is the piece that is needed for passes.

**General principle:** Before trusting a check, establish what would make it pass while the subject is broken and what would make it fail for its own reasons, with evidence proportional to what it compares — a stated argument where equality is exact, a measured collision rate where the comparison is partial — and require every verdict to carry the scale of what produced it.
**Evidence strength:** `observed-repeatedly` — three distinct instances in one construction phase, each a different shape, none detectable by the verification system itself.
**Covers themes:** Patterns 11 and 13.

### Lesson 12 — Report what was exercised, not what was intended

Every claim about what a verification covers should be traceable to something the machinery printed. The failure shape is consistent and it is not lying: **a limit stated more precisely than it is reads as a guarantee.** A gap described as belonging to one part of the system when it belongs to two. A component named by assumption when the run would have printed a different name. A setting described as fixed when it is a preference that falls through where its options are unavailable. Each one is defensible in isolation and each one silently claims completeness that was never there.

The defence that works is mechanical, not attentional: make the machinery **name the environment it actually used** — the components, their versions, the resolved value of anything declared as a preference rather than a guarantee, and the amount of material covered. Narrative claims are then checkable against those lines, by anybody, later.

Two warnings from watching this fail:

- **A correction can overstate in the opposite direction.** Having found that a claim was too strong, the natural next move is to assert divergence — which is another unmeasured claim wearing the costume of caution. Measure the correction too.
- **A figure that agrees with what you hoped is the one least likely to be checked.** Prefer figures carrying an internal relation a reader can verify at a glance, and report the parts alongside the total so the arithmetic is visible without running anything. A measurement added specifically to prevent an unfounded claim can itself be unfounded, and it will be believed more readily than the claim it replaced.

**General principle:** A claim about what a verification covers must be traceable to output the machinery produced; state every limit at its true width, measure corrections as well as claims, and prefer figures a reader can sanity-check without re-running anything.
**Evidence strength:** `observed-repeatedly` — five instances in one construction phase, every one caught by reading machine output and none by reasoning.
**Covers themes:** Pattern 12.

---

## Meta-Observations

**Option menus may be approximation-accepting devices.** `hypothesis`. Whenever a system offers a person a closed set of choices, answers may drift toward the nearest option rather than the true intent, because deviating costs more effort than accepting. The person in this session described exactly that experience, across tools and not only this one — which makes it well-motivated, but it remains one person and one interaction mode. Two claims are bundled here and should be separated: that *this* person's selected answers were weaker evidence than their composed ones (observed, and the safeguard in Lesson 2 stands on it alone), and that this is a general property of option interfaces (untested).

A way to test the second without another full session: present the same decision to different people in two forms — a closed set of options, and an open prompt with the same information — and compare the answers to what those people say when the consequences are later made concrete. **Keep the provenance safeguard regardless of the outcome**: it is justified by the first claim, which is the one that was observed.

**The measure of a question is the clarity it leaves behind, not the information it extracts.** A question that yields an answer while leaving the person less oriented than before has a negative return, and the debt is invisible at the time because the answer arrived. Optimise the sequence for the person's understanding at each step, not for the completeness of the record.

**A person's spontaneous restatement outranks many extracted answers.** When someone stops and says the thing in their own words, that statement is better evidence than a long chain of selected ones, and it is often the point where the real requirements first appear. Make room for it early and deliberately rather than waiting for it to arrive as a symptom of collapse.

**A person's verification question is the cheapest audit available.** When someone asks "is this actually checking what I think it is", answer by measuring rather than by explaining. In this engagement one such question — asked mildly, about whether the material was big enough — recovered a requirement that had been lost for days and, unasked, exposed the weakest check in the whole system. The person had no access to the internals; they had something better, which is a clear memory of what they asked for and no investment in the answer being yes.

**A correction that arrives with its measurement reads as diligence; one that arrives without reads as vacillation.** The same number of self-corrections can land either way, and the difference is whether each carries the evidence that produced it and the repair that followed. Reported by one person about one engagement and scoped by them to it, so treat this as a plausible mechanism rather than a finding — but if a method is going to produce visible self-correction, and a measurement-first method will, this is the form to produce it in.

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
- The specific rendering constructs, the platform pairs, and the component and version names that appeared in the coverage claims — the portable content is in Lesson 12; the names belong to one environment.
- Every figure from the measurements that exposed the weak comparison and the false coverage claims — the transferable part is the practice of measuring a comparison's power over the material it will run on (Lesson 11), never the numbers it produced here.
- The particular requirement whose intent was narrowed, and the property it concerned — the principle is Lesson 10; which requirement it happened to be is an accident of this subject.
- The specific invocation flag that suppressed a parser's input, and the tool it belonged to — an incident; the rule that caught it already exists in Lesson 9.
- The five-package sequencing analysis produced for the subject — the reusable content is the instruction to identify dependency structure among failing requirements (Lesson 8); the packages themselves belong to one product.

---

## Open Questions (Architectural)

1. **Is eliciting an existing model the same activity as co-constructing one that does not exist yet?** **Closed as a default, open as a universal: always assume co-construction.** `composed`, `confirmed` — as a default for the next revision; `hypothesis` as a general claim.

   The distinction is not pedantry, and this document's own evidence policy requires it: one engagement, one person, one domain cannot promote anything into a requirement of the method. What is settled is what the next revision should *do*. What is not settled is that co-construction is the right opening everywhere. Adopt it as the default, mark it as one, and validate it the way the policy prescribes — apply it to a person who demonstrably arrives with a settled model, in another domain, and measure what the concrete-first opening costs them. If the cost is real, the default needs a cheaper path for that case; if it is not, the default becomes a requirement.

   A method written for elicitation asks the person to choose between framings; one written for co-construction builds the framings from measurements first and offers the choice last. Detecting which situation applies is not viable: the only available detector is asking, and that question is unreliable in exactly the case that matters — a person without a settled model often does not know they lack one, and may open with a request that sounds precise.

   The asymmetry was expected to be *cost of error is low in one direction*. The person corrected that: **the concrete-first path pays even when the model is already clear.** In their words, someone with settled ideas simply moves through the concrete questions faster, and — from their experience, not from this session — there is always some aspect they had not considered, which the questions surface while there is still room to think about it. So the second branch is not a tolerable waste; it is a second reason to take the same path.

   This closes the branch rather than choosing between two live options: there is one procedure, and it starts from what the subject does today rather than from what quality means.

2. ~~**Should provisional decisions be allowed to flow into generated artifacts?**~~ **Settled: yes, marked as provisional — and the approval step is the promotion event.** `composed`, `confirmed`.

   Artifacts are written continuously during the interview, so a provisional decision reaches paper within minutes of being taken. Withholding them until every decision matures would stall the work and destroy the continuous-artifact practice, which is what makes a mid-session reset cheap. So provisional decisions flow, carrying their state.

   The method already has one moment where everything must mature in bulk — the approval that separates specification from construction — and it sits exactly on the boundary where revision stops being cheap. Before it there is only text; after it there is built work. That is the promotion event, and it needs no new ceremony because it already exists.

   **What must change is what happens there. The approval step must present the consequences, not request a signature.** Asking "do you approve?" after a long document collects silence and calls it consent, which Lesson 3 forbids. Evidence that this is not theoretical: in this session the approval step put the open points and the current pass/fail position in front of the person, and one of those points was revised at that moment rather than confirmed — a revision that cost minutes there and would have cost roughly half the built apparatus a week later. Same revision; different amount already built on top of it.

   **No maximum on how much is presented.** The person rejected a cap in favour of a sufficiency condition: enough to reach full agreement between what they and the project need, and what the specification says. Two consequences follow. The step ends on a condition, not on a quota — so it may be one item or twenty. And the condition is one only the person can evaluate, so the interviewer may not declare the step finished; it ends when the person says the gap is closed. Note also that they named two sources of requirement, their own needs *and* the project's, which are not always the same thing.

   **The approval is per decision, not per document.** Calling the approval a promotion event does not license promoting everything at once: a single "yes" at the end of a long document is precisely the collected silence Lesson 3 forbids, merely gathered into one place. So the approval view must **enumerate the decisions still provisional**, each with its concrete consequence, and record for each one an explicit confirmation or a revision. Anything not covered item by item stays provisional and is reported as provisional — the general statement that the gap is closed promotes nothing on its own.

   This costs less than it sounds, for two reasons: only provisional decisions appear, since confirmed ones were promoted where they matured; and the enumeration is generated from the record rather than composed. It also does something a bulk signature cannot — it makes the *quantity* of unexamined decisions visible at the one moment when it can still be acted on. Under the ceremony ledger this is a session-level step and not an addition to the per-question cycle, which the ledger requires be said aloud rather than assumed.

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

6. **Does the sample material belong to the specification phase or the construction phase?** Open.

   Lesson 10 turns on the person reading the material a check runs on and recognising that its scope is not what they meant. In this engagement the material was authored during construction, so that recognition arrived days after the specification had been approved — late enough that a requirement had been missing throughout.

   Moving it earlier would mean the specification phase produces at least representative material, so that scope becomes visible at the moment of approval alongside the consequences. Against that: the material is expensive to author, its shape is partly determined by decisions the specification has not yet made, and producing it early risks fixing the scope before the requirements settle — the same narrowing this lesson is about, arriving from the other direction.

   A middle position exists and is untested: the specification phase names the *dimensions* of the material — how large, how messy, how many, in the person's own units — without authoring it, and the construction phase is bound by those. That would put scope in front of the person at approval without paying to build anything. Whether a person can judge scope from a description rather than from the material itself is exactly the thing this engagement gives no evidence about, since here it took seeing the material.

   **While this is open, the instruction that carries the lesson must not quietly close it.** The rule an improving agent applies is therefore written to accept either form — material, or a statement of its dimensions in the person's own units — and to require the record to say which was used and whether the person's objection to scope arrived before the approval or after it. A handful of engagements carrying that record settle the question with evidence rather than with argument, which is the treatment this document's evidence policy demands of every other unvalidated claim in it.

---

## Agent Instructions

Process rules for an agent improving this target. Each derives from a lesson above.

1. Add the three-kinds classification to the method as a required step before any question is asked: derivable, informed by measurement, or only the person holds it. The classification applies to the **parts** of a question and its output is a list of parts with a kind each — a question is decomposed when its parts would be treated differently, and carries a single label when they would not. Every rule below that constrains questioning applies to a named subset of the three, never to all questions.

   **Ceremony ledger entry, since this is a mandatory interviewer action per question cycle.** Counted precisely, and separating what fires on every cycle from what fires only on some:

   - Before: two unconditional actions — justify the question as non-derivable (rule 2), and decide whether it owes a measurement (rule 8) — plus one conditional action, producing that measurement where it is owed.
   - After: one unconditional action — classify — which yields both of those answers as its output, since a part classified as derivable is by construction one that must not be asked, and a part classified as priceable is by construction one that owes a measurement. The conditional action is unchanged: the measurement still has to be produced.

   So the unconditional count goes from two to one, and the payment is real rather than rhetorical: rules 2 and 8 stop being steps beside the classification and become the criteria it applies. Decomposition adds nothing, because it is what the single action emits when a question's parts differ. What this entry does **not** claim is a saving on the work of measuring — that cost is untouched, and pretending otherwise is exactly the accounting the ledger exists to prevent.

2. State the test by which the classification in rule 1 decides that a part is derivable, so that rule genuinely absorbs this one instead of sitting beside it: a part is derivable when it is entailed by a prior decision, answerable by executing the subject, or reducible to a broader question that settles several points at once. Prefer removing such questions to adding scaffolding around them. Do **not** apply this test to questions about goals, consent, priorities, values or the person's direct experience — those must have a defined path that requires them to be asked, and asked early.
3. Extend the provenance scheme with a dimension that records authorship separately from confidence, distinguishing a statement the person composed from one they selected among offered options.
4. Specify, in the method itself and not per agent, the enumerated provenance values, decision states, allowed transitions, **cardinalities** and required fields. At minimum: authorship, exactly one of `composed` / `selected` / `inferred`; state, exactly one of `proposed` / `selected-provisional` / `stated-provisional` / `inferred-provisional` / `confirmed` / `superseded`; basis, **one or more** of `measurement` / `prior-decision` / `person's-experience` / `person's-preference` / `interviewer-recommendation`; and an evidence-gap field, required whenever a question had a part measurement could have priced and it was not priced — never triggered merely because the decision also rests on a non-measurement basis. Without enumeration, separate agents will implement incompatible meanings of the same word; without cardinality, a decision resting on several things at once will be recorded as resting on one.
5. Define the promotion event explicitly and forbid promotion by silence: a provisional decision becomes confirmed only when the person restates it in their own words, or explicitly affirms it after being shown a concrete consequence. This includes conclusions the interviewer reached without asking — they enter as provisional and are promoted only when the person is shown the conclusion together with what it was derived from. Require the collective approval step to enumerate the decisions still provisional and record a confirmation or a revision **for each**; anything not covered item by item stays provisional. Embed the replay in work already happening rather than adding a dedicated step.
6. Add supersession to every artifact schema — a way to mark a record as replaced, by what, and why — and treat revision as expected behaviour rather than an exception.
7. Require question sequencing to place those answerable from the person's direct experience before those needing the method's own vocabulary, and forbid opening with a choice between framings of the problem.
8. Require that the part of a question that measurement can price carry measurements produced by executing the subject on discriminating inputs, expressed in the person's domain — and require the choice between the priced options to be left to the person, since pricing an option is not choosing it. Extend the prescribed inspection scope from the subject alone to the tools that operate on the same artifacts, and require such external behaviour to be verified rather than recalled. Provide an explicit exception: where a choice cannot be executed, or measuring would be unsafe, privacy-invading or disproportionate, require the strongest available grounded evidence and a recorded evidence gap instead. Never fabricate a measurement to satisfy the form of the rule.
9. Add a diagnostic rule: a question not answered on its second presentation indicates the wrong axis, not poor wording — the response is to obtain a measurement or ask what the person would measure, never to reword the same choice a third time.
10. Separate the register used in artifacts from the register used with people: internal identifiers and discipline-specific terminology must not appear in text addressed to the person.
11. Provide a schema for every artifact the method names, with the earliest phase's artifacts held to the same standard as the final ones.
12. Add explicit handling for the case where the specification describes a system that does not yet exist: gate placement that does not obstruct the remedy; identification of which failing requirements verification shows to be one problem rather than several, each marked as observed or inferred; and a statement of what a reader still needs beyond the specification in order to implement it. Forbid the method from turning that dependency report into a prescribed build order — reporting what verification demonstrates is inside the discipline, sequencing the work is not.
13. Extend the mutation set with prerequisite sabotage, and require the verification system to distinguish `requirement-failure`, `harness-failure` and `coverage-gap` as separate reported statuses, all of which block a green result. Add a fourth, `declared-unautomated`, which does not block a green result and is available only by declaration in the specification — carrying a reason, the route by which the requirement is evidenced instead, and an owner — never by inference from the runner finding nothing to run. Require it to be printed with its count in every report. Require an audit of the existing suite for skip-and-succeed behaviour.
14. Add a comparison step after a requirement is written: restate what the checkable version does NOT cover relative to the person's own words, and present that alongside the requirement. Where a template offers a field for exceptions, require any exception recorded there to be traceable to something the person said rather than to what was convenient to check.
15. Require the scope of the material a check will run on to be put in front of the person at approval, not only the requirement — because sample inputs encode size, messiness and quantity that no requirement text carries, and a person will object to material long after reading past an exception clause. **Leave the form conditional**, since Open Question 6 is open: accept either representative material, or a statement of the material's dimensions in the person's own units, and do not let this instruction settle the phase boundary by default. Require the record to say which form was used, and whether an objection to scope arrived before the approval or after it; that record is what settles the question across a few engagements.
16. Extend the audit beyond "the subject is broken, does a check fail" and "the prerequisites are broken, does the run fail" to a third question: does a check that runs actually measure the subject. Require, per check, a stated answer to what would make it pass while the subject is broken and what would make it fail for reasons of its own.

    **Scale the evidence to the kind of comparison, and say so in the method, or "per check" becomes ceremony nobody can verify.** Three classes, with the minimum each must supply:

    - **Exact comparison over the whole artifact** — equality of the complete value or its bytes. A direct argument suffices: state why a wrong answer cannot compare equal. No measurement is owed, because collision is excluded by construction.
    - **A threshold on a measured quantity.** State the threshold's relation to the measurement's own noise, established once for the measurement rather than once per check. A threshold inside the noise is not a check.
    - **A partial, sampled or heuristic comparison** — matching a token, a fragment, a summary, anything less than the whole. Here the discriminating power must be **measured over the material the check will actually run on**: how often would this comparison report agreement for a wrong answer? An argument is not admissible in this class, because the whole failure mode is that the argument sounds right.

    Require each check to declare its class. The declaration is what makes the obligation checkable by someone else later, and it is where a comparison quietly weaker than it looks becomes visible.
17. Require every verdict to carry the scale of what produced it, on passes as well as failures. Evidence is conventionally demanded only for failures, which is backwards for the question "did this look at enough".
18. Require the machinery to print the environment it actually used — components, versions, the resolved value of anything declared as a preference rather than a guarantee, and the amount of material covered — and require every narrative claim about coverage to be traceable to those lines. Apply the same rule to corrections: a claim that a previous claim was too strong is itself a claim and needs its own measurement.
19. Review the bundled example material against these rules — an example that models a question the method should no longer ask will reproduce the defect in every session that reads it.

Constraints the improving agent must respect:

- Do not weaken the ordering that requires the specification to be amended and re-approved BEFORE any check is changed. It was exercised twice under real pressure and both times it worked, and it is what turns a requirement recovered late into a routine amendment rather than an argument about whether it was ever agreed.
- Do not weaken the rule that a check unable to execute is a failure. Once present it repeatedly converted empty passes into named failures, and it is the single most productive rule added in this engagement. The status for a requirement declared unautomated is not a softening of this rule and must never become something a run can award itself: the moment a runner can decide that a requirement was not meant to be checked, the rule is gone and the silent skip is back under a respectable name.
- Do not weaken the barrier that forbids entering the implementation phase without an explicit, recorded approval. It held under pressure in this session and is the method's most load-bearing rule.
- Do not remove the phase structure or the statement of what each phase is permitted to output. It is what keeps a long session from drifting into premature implementation.
- Do not remove the requirement to classify each requirement by kind, nor the ordering that prefers deterministic verification and admits model-based judgement only as a remainder. Both produced measurably better artifacts in this session.
- Do not remove the audit principle that a passing suite which fails to detect a representative mutation is evidence of a gap rather than a result.
- Preserve the practice of maintaining artifacts continuously during the interview rather than writing them up at the end; it is what made a mid-session reset cheap to absorb.
- **Ceremony budget, enforced by a ledger rather than by intention.** The unit is *mandatory interviewer actions per question cycle*: steps the method obliges the interviewer to perform for each question asked. Any change proposal that raises that count must name, in the same proposal, the specific action it removes or automates to pay for it, and state the count before and after. A proposal that cannot name its payment is rejected. Changes that add optional guidance, or that add a step to the session as a whole rather than to each question cycle, are outside the budget and must say so explicitly rather than being quietly exempted. The person's ranking in this session rejected every remedy that added a step and accepted every remedy that removed one; this ledger is what stops that preference from being eroded one reasonable-looking addition at a time.
- Validation criterion, without re-running the original session: apply the revised method to a subject in a different domain and check that **no priceable part of a question** is put to the person before it has been priced; that questions about goals, consent, priorities and direct experience *are* asked, and asked before the abstractions; that every recorded conclusion states whether it was composed, selected or inferred, and whether it reached the confirmed state through an event of its own rather than through silence or through a single collective approval; that an evidence gap is recorded wherever a measurement that was owed is missing, and is *not* recorded merely because a decision also rests on a preference; and that no text addressed to the person contains an identifier defined only inside an artifact.
