"use strict";

// Every check the suite knows about.
//
// The runner compares this list against the requirements the contract declares
// and reports any requirement with no check. A requirement quietly missing a
// check would be the QA system reproducing the exact failure it exists to
// prevent: something disappearing without a trace.

module.exports = [
  ...require("./family-a"),
  ...require("./family-b"),
  ...require("./family-c"),
  ...require("./family-d"),
  ...require("./family-ef"),
  ...require("./family-g"),
];
