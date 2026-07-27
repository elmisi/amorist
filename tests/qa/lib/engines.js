"use strict";

// Engine discovery and startup.
//
// The rule from the contract (fallback_policies.missing_engine): an engine that
// cannot be found or started FAILS the run and names itself. It never degrades
// to "the other one passed, so we are fine" — one engine missing means half the
// coverage is absent, which is exactly what a report must not hide.
//
// The checks still run on whatever engine IS available, because a partial
// result is more useful than none. The exit code is red either way.

const { ChromiumEngine } = require("./engine-chromium");
const { WebKitEngine } = require("./engine-webkit");

const REGISTRY = [
  {
    id: "webkitgtk",
    role: "shipping",
    description: "the engine the Linux application runs inside",
    Engine: WebKitEngine,
  },
  {
    id: "chromium",
    role: "stand-in",
    description: "a Chromium-family browser, kept for speed and for cross-checking",
    Engine: ChromiumEngine,
  },
];

function resolveEngines(only) {
  return REGISTRY
    .filter((entry) => !only || only.includes(entry.id))
    .map((entry) => {
      const found = entry.Engine.discover();
      return {
        id: entry.id,
        role: entry.role,
        description: entry.description,
        available: found.available === true,
        reason: found.reason || "",
        create: () => new entry.Engine(found.binary, found.browser),
      };
    });
}

module.exports = { resolveEngines, REGISTRY };
