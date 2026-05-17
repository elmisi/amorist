export const PLAN_CYCLE_NOTE_PATTERN = /^> \*\*NOTE\*\*:/m;

export const PLAN_CYCLE_SAMPLE = `# Plan: Example

## Task Breakdown
- [ ] Task 1

> **NOTE**: clarify this task

\`\`\`ts
export const value = 1;
\`\`\`
`;

export function serializeMarkdown(markdown: string): string {
  return markdown;
}

export function noteLineCount(markdown: string): number {
  return markdown
    .split(/\r?\n/)
    .filter((line) => /^> \*\*NOTE\*\*:/.test(line)).length;
}

export function preservesPlanCycleNotes(
  original: string,
  serialized: string,
): boolean {
  const originalCount = noteLineCount(original);
  if (originalCount === 0) {
    return true;
  }

  return (
    noteLineCount(serialized) === originalCount &&
    PLAN_CYCLE_NOTE_PATTERN.test(serialized)
  );
}
