"use strict";

// Fixture loading.
//
// The checks iterate over this directory; they never list cases in code. Adding
// a newly discovered breaking case is therefore a copy, not a code change —
// which is also how every real defect becomes a permanent regression case.
//
// An empty or unreadable directory is a FAILURE, not an empty pass (REQ-G1). A
// check that iterates over zero files and reports success is the worst possible
// outcome: it is green precisely when it is blind.

const fs = require("node:fs");
const path = require("node:path");

// Overridable so that the suite can be pointed at a deliberately empty
// directory and asked to prove it fails (REQ-G1). Nothing else may use this.
const CORPUS_DIR = process.env.AMORIST_QA_CORPUS
  ? path.resolve(process.env.AMORIST_QA_CORPUS)
  : path.resolve(__dirname, "..", "corpus");

function loadCorpus(directory = CORPUS_DIR) {
  let names;
  try {
    names = fs.readdirSync(directory);
  } catch (error) {
    throw new Error(`The fixture directory ${directory} cannot be read: ${error.message}`);
  }

  const fixtures = names
    .filter((name) => name.endsWith(".md"))
    .sort()
    .map((name) => {
      const bytes = fs.readFileSync(path.join(directory, name));
      return {
        name,
        path: path.join(directory, name),
        bytes,
        // The exact file text, terminators and all. NOT normalised: the editor
        // must be transparent to what is in the file, and a check that
        // normalises first cannot see the requirement it is meant to verify.
        text: bytes.toString("utf8"),
      };
    });

  if (!fixtures.length) {
    throw new Error(
      `The fixture directory ${directory} contains no .md files. `
      + "A check that iterates over zero files must not pass (REQ-G1).",
    );
  }

  return fixtures;
}

module.exports = { loadCorpus, CORPUS_DIR };
