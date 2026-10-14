"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

// AppImage's launcher can detach the editor from WebDriver's child process.
// Close through the real application, then prove its owned process exited.
async function closeOwnedNative(engine) {
  if (!engine.sessionId) return engine.close();
  assert.equal(process.platform, "linux");
  const data = engine.environment.XDG_DATA_HOME;
  assert.ok(data && data.startsWith(path.join(os.tmpdir(), "amorist-")), "Requires isolated QA app-data");
  const document = engine.applicationArgs.at(-1);
  if(document) assert.ok(document.startsWith(path.dirname(data) + path.sep), "Requires an owned QA document");
  const nonce=engine.environment.AMORIST_QA_INSTANCE_NONCE;
  assert.ok(nonce,"Requires a distinct native QA instance identity");
  const matches = [];
  const executable=fs.realpathSync(engine.environment.AMORIST_CODEC_QA_BINARY || engine.application);
  for (const entry of fs.readdirSync("/proc")) {
    if (!/^\d+$/.test(entry)) continue;
    try {
      const proc = "/proc/" + entry;
      const exe = fs.readlinkSync(proc + "/exe");
      if (path.basename(exe) !== "amorist") continue;
      const args = fs.readFileSync(proc + "/cmdline", "utf8").split("\0");
      if (document && !args.includes(document)) continue;
      const env = Object.fromEntries(fs.readFileSync(proc + "/environ", "utf8").split("\0")
        .filter(value => value.includes("=")).map(value => { const at=value.indexOf("=");return [value.slice(0,at),value.slice(at+1)]; }));
      if (env.XDG_DATA_HOME !== data || env.DISPLAY !== engine.environment.DISPLAY || env.AMORIST_QA_INSTANCE_NONCE !== nonce) continue;
      if (exe !== executable && (env.APPIMAGE !== executable || exe !== path.join(env.APPDIR || "", "usr/bin/amorist"))) continue;
      matches.push({pid: Number(entry), stat: fs.readFileSync(proc + "/stat", "utf8").split(") ")[1].split(" ")[19]});
    } catch (error) { if (!["ENOENT", "ESRCH", "EACCES"].includes(error.code)) throw error; }
  }
  assert.equal(matches.length, 1, "Exactly one owned application must be identified before closing");
  const identity = matches[0];
  await engine.evaluate(`(() => {setTimeout(()=>window.__TAURI__.core.invoke('force_close'),100);return true;})()`);
  const deadline = Date.now() + 5000;
  while (true) {
    try {
      const fields = fs.readFileSync(`/proc/${identity.pid}/stat`, "utf8").split(") ")[1].split(" ");
      if (fields[0] === "Z" || fields[19] !== identity.stat) break;
    } catch (error) { if (error.code === "ENOENT") break; throw error; }
    assert.ok(Date.now() < deadline, `Owned application ${identity.pid} did not exit`);
    await new Promise(resolve => setTimeout(resolve,25));
  }
  engine.sessionId = "";
  await engine.close();
}
module.exports = {closeOwnedNative};
