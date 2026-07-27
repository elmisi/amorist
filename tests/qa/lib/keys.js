"use strict";

// One symbolic key vocabulary, translated per engine.
//
// Checks say {key: "Enter"} and never say what an engine calls it. A check that
// knows which engine it is running on has stopped comparing the two, which is
// the only reason both are run.

// Windows virtual key codes and DOM codes, for the DevTools protocol.
const CDP = {
  Enter: { code: "Enter", vk: 13, text: "\r" },
  Backspace: { code: "Backspace", vk: 8 },
  Delete: { code: "Delete", vk: 46 },
  Tab: { code: "Tab", vk: 9 },
  Escape: { code: "Escape", vk: 27 },
  ArrowLeft: { code: "ArrowLeft", vk: 37 },
  ArrowUp: { code: "ArrowUp", vk: 38 },
  ArrowRight: { code: "ArrowRight", vk: 39 },
  ArrowDown: { code: "ArrowDown", vk: 40 },
  Home: { code: "Home", vk: 36 },
  End: { code: "End", vk: 35 },
};

// Private-use code points, for the standard WebDriver actions API. Written as
// escapes on purpose: these characters are invisible, and one stripped in
// transit by a formatter would produce a key that silently does nothing.
const WEBDRIVER = {
  Backspace: "\uE003",
  Tab: "\uE004",
  Enter: "\uE007",
  Escape: "\uE00C",
  End: "\uE010",
  Home: "\uE011",
  ArrowLeft: "\uE012",
  ArrowUp: "\uE013",
  ArrowRight: "\uE014",
  ArrowDown: "\uE015",
  Delete: "\uE017",
};

const WEBDRIVER_MODIFIERS = {
  shift: "\uE008",
  ctrl: "\uE009",
  alt: "\uE00A",
  meta: "\uE03D",
};

// The DevTools protocol takes modifiers as a bitmask.
const CDP_MODIFIERS = { alt: 1, ctrl: 2, meta: 4, shift: 8 };

function isNamedKey(name) {
  return Object.prototype.hasOwnProperty.call(CDP, name);
}

// A key sequence is an array whose items are either a string of literal text to
// type, or an object naming one key with optional modifiers.
function normalizeSequence(keys) {
  const out = [];
  for (const item of Array.isArray(keys) ? keys : [keys]) {
    if (typeof item === "string") {
      for (const char of Array.from(item)) out.push({ text: char });
      continue;
    }
    if (!item || typeof item.key !== "string") {
      throw new Error(`Unusable key item: ${JSON.stringify(item)}`);
    }
    out.push({
      key: item.key,
      ctrl: Boolean(item.ctrl),
      shift: Boolean(item.shift),
      alt: Boolean(item.alt),
      meta: Boolean(item.meta),
      repeat: item.repeat || 1,
    });
  }
  return out;
}

module.exports = {
  CDP,
  CDP_MODIFIERS,
  WEBDRIVER,
  WEBDRIVER_MODIFIERS,
  isNamedKey,
  normalizeSequence,
};
