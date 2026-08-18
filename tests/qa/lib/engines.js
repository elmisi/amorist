"use strict";

// Engine discovery, per platform.
//
// Two rules from the contract, and the difference between them is the whole
// design:
//
//   missing_engine — an engine that BELONGS on this platform and cannot be
//     started fails the run and names itself. Never skipped-and-green, and never
//     "another engine passed, so we are fine".
//
//   inapplicable_engine — an engine that does not belong on this platform is
//     skipped and recorded as inapplicable. This is the ONE skip the suite
//     permits anywhere, and it is safe only because applicability is DECLARED
//     below rather than detected. A skip decided by detection would be the
//     silent pass arriving through the front door.
//
// The checks still run on whatever is available, because a partial result is
// more useful than none. The exit code is red either way.

const { ChromiumEngine } = require("./engine-chromium");
const { WebKitGtkEngine } = require("./engine-webkitgtk");
const { SafariEngine } = require("./engine-safari");

// Mirrors REQ-G2's platform_engines. If the two ever disagree, the contract is
// right and this is wrong.
const REGISTRY = [
  {
    id: "webkitgtk",
    role: "shipping",
    platforms: ["linux"],
    description: "the engine the Linux application runs inside",
    Engine: WebKitGtkEngine,
  },
  {
    id: "safari",
    role: "shipping",
    platforms: ["darwin"],
    description:
      "the engine the macOS application runs inside — same engine, different "
      + "embedding: this covers the engine, not the embedding",
    Engine: SafariEngine,
  },
  {
    id: "chromium",
    role: "stand-in",
    platforms: ["linux", "darwin"],
    description: "a Chromium-family browser, kept for speed and for cross-checking",
    Engine: ChromiumEngine,
  },
];

function platformName() {
  return process.platform;
}

function resolveEngines(only) {
  const platform = platformName();
  return REGISTRY
    .filter((entry) => !only || only.includes(entry.id))
    .map((entry) => {
      const applicable = entry.platforms.includes(platform);
      if (!applicable) {
        return {
          id: entry.id,
          role: entry.role,
          description: entry.description,
          applicable: false,
          available: false,
          reason: `not applicable on ${platform}; declared for ${entry.platforms.join(", ")}`,
          create: null,
        };
      }
      const found = entry.Engine.discover();
      return {
        id: entry.id,
        role: entry.role,
        description: entry.description,
        applicable: true,
        available: found.available === true,
        reason: found.reason || "",
        create: () => new entry.Engine(found.binary, found.browser),
      };
    });
}

// Which published platforms this run says nothing about. A run on one platform
// is evidence about one platform, and the report must say so rather than let
// silence imply coverage.
function publishedPlatformsNotCovered() {
  const platform = platformName();
  return [
    { platform: "linux", covered: platform === "linux" },
    { platform: "macos", covered: platform === "darwin" },
  ].filter((entry) => !entry.covered).map((entry) => entry.platform);
}

module.exports = { resolveEngines, publishedPlatformsNotCovered, platformName, REGISTRY };
