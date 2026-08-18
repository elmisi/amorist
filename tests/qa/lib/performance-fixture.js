"use strict";

function performanceFixture(lineCount) {
  if (lineCount !== 500 && lineCount !== 1500) {
    throw new Error("Performance fixtures are defined only for 500 or 1500 physical lines.");
  }
  const lines = [];
  let plainLine = -1;
  let tableLine = -1;
  for (let index = 0; index < lineCount;) {
    if (index > 0 && index % 40 === 0 && index + 3 <= lineCount) {
      if (tableLine < 0) {
        tableLine = index;
        lines.push("| TABLE_TARGET | compact | value |");
      } else lines.push(`| row-${index} | compact | value |`);
      lines.push("|---|---|---|");
      lines.push(`| longer-cell-${index} | x | ragged |`);
      index += 3;
      continue;
    }
    if (plainLine < 0 && index === 10) {
      plainLine = index;
      lines.push("Plain PLAIN_TARGET text remains local.");
    } else if (index % 3 === 0) lines.push(`- list filler ${index} with stable content`);
    else lines.push(`Prose filler ${index} with stable deterministic content.`);
    index += 1;
  }
  const markdown = lines.join("\n");
  return {
    markdown,
    lineCount: lines.length,
    plainLine,
    tableLine,
    plainOffset: markdown.indexOf("PLAIN_TARGET") + "PLAIN_TARGET".length,
    tableOffset: markdown.indexOf("TABLE_TARGET") + "TABLE_TARGET".length,
  };
}

module.exports = { performanceFixture };
