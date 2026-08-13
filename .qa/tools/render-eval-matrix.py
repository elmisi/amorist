#!/usr/bin/env python3
"""Regenerate .qa/eval-matrix.md and .qa/contract.json from the contract.

contract.json is the machine-readable projection the runner reads. It exists so
that a requirement with no check is a loud failure rather than a silent absence:
the runner compares the checks it has against the requirements the contract
declares, and refuses to report success when one is missing.
"""
import json, yaml, collections, pathlib

# Relative to this file, never to a machine. An absolute path here worked on
# the desk it was written on and failed on the first runner that used it.
root = pathlib.Path(__file__).resolve().parent.parent
contract = yaml.safe_load((root / "qa-contract.yaml").read_text())
register = yaml.safe_load((root / "risk-register.yaml").read_text())

reqs = contract["requirements"]
risks_for = collections.defaultdict(list)
for r in register["risks"]:
    for vid in r.get("verification_ids") or []:
        risks_for[vid].append(r["id"])

def one_line(s, width=90):
    s = " ".join(str(s).split())
    return s if len(s) <= width else s[: width - 1].rstrip() + "…"

def state(r):
    ch = r.get("currently_holds")
    if ch is True:
        return "green today"
    if ch == "partially":
        return "partial"
    return "RED today"

rows = []
for r in reqs:
    rows.append(
        "| `{id}` | {stmt} | {risks} | {vtype} | {sev} | {auto} | {cost} | {fp} | {st} |".format(
            id=r["id"],
            stmt=one_line(r["statement"]),
            risks=", ".join(sorted(risks_for.get(r["id"], []))) or "—",
            vtype=r["verification"]["type"],
            sev=r["severity"],
            auto=r["automation"],
            cost=one_line(r["estimated_cost"], 24),
            fp=r["false_positive_risk"],
            st=state(r),
        )
    )

n = len(reqs)
green = sum(1 for r in reqs if r.get("currently_holds") is True)
partial = sum(1 for r in reqs if r.get("currently_holds") == "partially")
red = n - green - partial
blocking = sum(1 for r in reqs if r["severity"] == "blocking")
advisory = n - blocking
det = sum(1 for r in reqs if r["verification"]["type"] == "deterministic")
man = n - det

# cross-check: every requirement maps to a risk, every risk to a requirement
uncovered_reqs = [r["id"] for r in reqs if not risks_for.get(r["id"])]
uncovered_risks = [r["id"] for r in register["risks"] if not (r.get("verification_ids") or [])]
assert not uncovered_reqs, f"requirements with no risk: {uncovered_reqs}"
assert not uncovered_risks, f"risks with no verification: {uncovered_risks}"

out = f"""# Evaluation matrix — amorist

Generated from `.qa/qa-contract.yaml` and `.qa/risk-register.yaml`. Do not edit
by hand: change the contract and regenerate, otherwise the two disagree and the
matrix silently becomes fiction.

Contract status: **{contract['status']}** ({contract.get('approved_on','')}). This file is
generated; the contract is the source of truth.

| Requirement | What it says | Risks | Verification | Gate | Automation | Cost | False-positive risk | State |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
""" + "\n".join(rows) + f"""

## Reading this table

**State** is measured against the repository at commit a9d7e73, not assumed:
{green} requirements hold today, {partial} holds partially, {red} fail. The suite is
expected to be red on first run — the contract specifies the editor that must
exist, not the one that does.

**Gate**: {blocking} blocking, {advisory} advisory. A blocking failure stops
publication of a release; it does not stop a commit, a merge or a push
(`G-PUSH` in the contract).

**Verification**: {det} deterministic, {man} manual. No requirement is verified by
a model. The runner never calls one, so a red result always means the code is
wrong — never that a service was unavailable or a model was inconsistent.

**Engines**: every check in families A, B, C and D runs twice — on the engine the
Linux application ships inside, and on a stand-in — and must pass on both
(`REQ-G2`). One engine unavailable fails the run; it does not pass on the
strength of the other.

## Unverifiable or human-reviewed qualities

| Quality | Owner | Cadence | Evidence | Why no automated proxy |
| --- | --- | --- | --- | --- |
| Behaviour on macOS, whose engine (WKWebView) cannot be driven | repository owner | once per release, while macOS is published | the six-case manual list in `REQ-G3`, recorded in the release entry | The Linux engine is driven directly and is no longer a hole. macOS has no equivalent driver and the Tauri WebDriver wrapper does not support it; a different build of the same engine family would be a proxy, not the engine that ships. The obligation is scoped to published platforms, so dropping the platform closes it. |
| Whether the editing model still feels right after the rewrite | repository owner | after packages 2 and 3 | a written note, not a check | Taste is not a contract term. It is recorded here so that it is not smuggled in as one. |

## What this matrix deliberately does not contain

- **Coverage percentages.** Every requirement maps to at least one risk and every
  risk to at least one requirement (cross-checked mechanically, and this file
  fails to generate if that stops being true). A percentage on top of that would
  add a number, not information.
- **Semantic evaluation in the gate.** A model may be used outside the gate to
  discover new paste cases (`REQ-D1`); anything it finds becomes a deterministic
  fixture. The verdict is never a model's.
"""

(root / "eval-matrix.md").write_text(out)

(root / "contract.json").write_text(json.dumps({
    "status": contract["status"],
    "approvedOn": str(contract.get("approved_on", "")),
    "generatedFrom": "qa-contract.yaml",
    "requirements": [
        {
            "id": r["id"],
            "statement": " ".join(str(r["statement"]).split()),
            "severity": r["severity"],
            "verification": r["verification"]["type"],
            "automation": r["automation"],
            "family": r["id"].split("-")[1][0],
            "currentlyHolds": r.get("currently_holds"),
            "allowedChange": r.get("allowed_change"),
            "risks": sorted(risks_for.get(r["id"], [])),
        }
        for r in reqs
    ],
}, indent=2, ensure_ascii=False) + "\n")
print(f"{n} requirements | {green} green, {partial} partial, {red} red | "
      f"{blocking} blocking, {advisory} advisory | {det} deterministic, {man} manual")
print("cross-check ok: no orphan requirement, no unverified risk")
