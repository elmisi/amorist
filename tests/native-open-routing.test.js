"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { install } = require("../web/native-open");

function harness() {
  const h = { pending: [], opened: [], spawned: [], errors: [], busy: false, available: true, reads: 0 };
  h.options = {
    listen: async (listener) => { h.notify = listener; },
    take: async () => { h.reads++; return h.pending.splice(0); },
    isBusy: () => h.busy, canUseInitial: () => h.available,
    openInitial: async (path) => { h.opened.push(path); },
    spawn: async (path) => { h.spawned.push(path); },
    error: (error) => { h.errors.push(String(error)); },
  };
  return h;
}
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test("Finder events before document readiness retain order, report errors and use the initial window once", async () => {
  const h = harness();
  const controller = await install(h.options);
  h.pending.push({error: "missing file"}, {path: "/tmp/first caffè.md"}, {path: "/tmp/second.md"});
  h.notify();
  assert.equal(h.reads, 0);
  await controller.ready();
  assert.deepEqual(h.errors, ["missing file"]);
  assert.deepEqual(h.opened, ["/tmp/first caffè.md"]);
  assert.deepEqual(h.spawned, ["/tmp/second.md"]);
});

test("an initial CLI, recovered or previously used document is preserved even when clean", async () => {
  const h = harness(); const controller = await install(h.options);
  controller.claim();
  h.pending.push({path: "another.md"});
  await controller.ready();
  assert.deepEqual(h.opened, []); assert.deepEqual(h.spawned, ["another.md"]);
});

test("declining startup recovery leaves the blank window available for the first queued Finder file", async () => {
  const h = harness(); const controller = await install(h.options);
  h.pending.push({path: "first.md"}, {path: "second.md"});
  h.notify();
  controller.documentAdopted({path: null, recoveryCandidates: [{sessionId: "old-copy"}]});
  await controller.ready();
  assert.deepEqual(h.opened, ["first.md"]);
  assert.deepEqual(h.spawned, ["second.md"]);
});

test("an adopted file or explicitly recovered unnamed copy keeps its window even when the recovered source is empty", async () => {
  for (const document of [{path: "existing.md"}, {path: null, recoveryMarkdown: ""}, {path: null, recoveryMarkdown: "recovered"}]) {
    const h = harness(); const controller = await install(h.options);
    controller.documentAdopted(document);
    h.pending.push({path: "another.md"});
    await controller.ready();
    assert.deepEqual(h.opened, []);
    assert.deepEqual(h.spawned, ["another.md"]);
  }
});

test("native requests wait for a dialog and recheck whether the initial document was used", async () => {
  const h = harness(); const controller = await install(h.options);
  h.busy = true; h.pending.push({path: "after-dialog.md"});
  const running = controller.ready();
  await pause(20);
  assert.deepEqual(h.opened, []); assert.deepEqual(h.spawned, []);
  controller.claim(); h.busy = false;
  await running;
  assert.deepEqual(h.opened, []); assert.deepEqual(h.spawned, ["after-dialog.md"]);
});

test("events arriving during the first open remain serialized and drain after it", async () => {
  const h = harness(); let release, started;
  const opening = new Promise((resolve) => { started = resolve; });
  h.options.openInitial = async (path) => {
    h.opened.push(path); started();
    await new Promise((resolve) => { release = resolve; });
  };
  const controller = await install(h.options);
  h.pending.push({path: "first.md"}); const running = controller.ready();
  await opening;
  h.pending.push({path: "second.md"}); h.notify();
  assert.deepEqual(h.spawned, []);
  release(); await running;
  assert.deepEqual(h.opened, ["first.md"]); assert.deepEqual(h.spawned, ["second.md"]);
});

test("failed launches report an error and do not drop remaining requests", async () => {
  const h = harness(); h.available = false;
  h.options.spawn = async (path) => { if (path === "failed.md") throw new Error("launch failed"); h.spawned.push(path); };
  const controller = await install(h.options);
  h.pending.push({path: "failed.md"}, {path: "next.md"});
  await controller.ready();
  assert.match(h.errors[0], /launch failed/); assert.deepEqual(h.spawned, ["next.md"]);
});
