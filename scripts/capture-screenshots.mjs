#!/usr/bin/env node
import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { spawn } from "node:child_process";

const root = new URL("..", import.meta.url);
const outDir = new URL("../docs/screenshots/", import.meta.url);
const baseUrl = "http://127.0.0.1:1420";

await mkdir(outDir, { recursive: true });

const server = spawn("npm", ["run", "dev"], {
  cwd: root,
  stdio: "inherit",
  env: { ...process.env, BROWSER: "none" },
});

async function waitForServer() {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(baseUrl);
      if (response.ok) return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  throw new Error(`Timed out waiting for ${baseUrl}`);
}

try {
  await waitForServer();
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1366, height: 860 } });

  await page.goto(`${baseUrl}/?screenshot=source`);
  await page.screenshot({
    path: new URL("source-mode.png", outDir).pathname,
    fullPage: true,
  });

  await page.goto(`${baseUrl}/?screenshot=wysiwyg`);
  await page.waitForSelector(".milkdown-shell");
  await page.screenshot({
    path: new URL("wysiwyg-mode.png", outDir).pathname,
    fullPage: true,
  });

  await page.goto(baseUrl);
  await page.screenshot({
    path: new URL("empty-state.png", outDir).pathname,
    fullPage: true,
  });

  await browser.close();
} finally {
  server.kill("SIGTERM");
}
