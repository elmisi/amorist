import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { hasPlanCycleNotes } from "../files/markdownFiles";
import { preservesPlanCycleNotes, serializeMarkdown } from "./editorSerialization";

const fixture = (name: string) =>
  readFileSync(resolve(process.cwd(), "fixtures", name), "utf8");

describe("plan-cycle compatibility", () => {
  it("preserves note lines in the basic fixture", () => {
    const input = fixture("plan-cycle-sample.md");
    const output = serializeMarkdown(input);

    expect(output).toContain("# Plan: Fixture");
    expect(output).toContain("- [ ] Draft implementation");
    expect(output).toContain("```ts");
    expect(output).toContain("`inline code`");
  });

  it("keeps NOTE lines grep-detectable", () => {
    const input = fixture("plan-cycle-with-notes.md");
    const output = serializeMarkdown(input);

    expect(hasPlanCycleNotes(output)).toBe(true);
    expect(preservesPlanCycleNotes(input, output)).toBe(true);
    expect(output).toMatch(/^> \*\*NOTE\*\*:/m);
  });
});
