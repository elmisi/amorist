import { describe, expect, it } from "vitest";
import {
  PLAN_CYCLE_SAMPLE,
  preservesPlanCycleNotes,
  serializeMarkdown,
} from "./editorSerialization";

describe("editor serialization contract", () => {
  it("keeps key Markdown constructs in the plan-cycle sample", () => {
    const output = serializeMarkdown(PLAN_CYCLE_SAMPLE);

    expect(output).toContain("# Plan: Example");
    expect(output).toMatch(/^> \*\*NOTE\*\*: clarify this task$/m);
    expect(output).toContain("```ts");
    expect(output).toContain("- [ ] Task 1");
  });

  it("detects whether note lines survive serialization", () => {
    expect(preservesPlanCycleNotes(PLAN_CYCLE_SAMPLE, PLAN_CYCLE_SAMPLE)).toBe(
      true,
    );
    expect(preservesPlanCycleNotes(PLAN_CYCLE_SAMPLE, "# Plan\n")).toBe(false);
  });
});
