"use strict";

// A static file server for the harness page, so that both engines load the
// editor from one stable origin instead of from file://, where the two differ
// in what they allow.
//
// This is NOT bin/amorist. The deprecated Python server is outside the contract
// perimeter (D-020) and must never become a dependency of the gate. This serves
// bytes off disk and nothing else: no API, no token, no document handling.

const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".md": "text/plain; charset=utf-8",
};

function startStaticServer(rootDir) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const requested = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
      const resolved = path.resolve(rootDir, "." + requested);
      if (!resolved.startsWith(path.resolve(rootDir))) {
        res.writeHead(403).end("forbidden");
        return;
      }
      fs.readFile(resolved, (error, data) => {
        if (error) {
          res.writeHead(404).end("not found");
          return;
        }
        res.writeHead(200, {
          "content-type": TYPES[path.extname(resolved)] || "application/octet-stream",
          "cache-control": "no-store",
        });
        res.end(data);
      });
    });
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({
        origin: `http://127.0.0.1:${port}`,
        stop: () => new Promise((done) => server.close(done)),
      });
    });
  });
}

module.exports = { startStaticServer };
