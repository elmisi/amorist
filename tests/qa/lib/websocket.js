"use strict";

// Minimal WebSocket client, node builtins only.
//
// Lifted from tests/app-shell-smoke.test.js, with one correction: that version
// cannot encode a payload of 64 KiB or more, which a large injected script
// reaches easily. Frames of every length are handled here.

const crypto = require("node:crypto");
const net = require("node:net");

class WebSocketConnection {
  constructor(socket) {
    this.socket = socket;
    this.nextId = 1;
    this.pending = new Map();
    this.buffer = Buffer.alloc(0);
    this.closed = false;
    socket.on("data", (chunk) => this.receive(chunk));
    socket.on("error", (error) => this.failAll(error));
    socket.on("close", () => {
      if (!this.closed) this.failAll(new Error("WebSocket closed unexpectedly."));
    });
  }

  failAll(error) {
    for (const { reject } of this.pending.values()) reject(error);
    this.pending.clear();
  }

  static open(webSocketUrl, timeoutMs = 10000) {
    return new Promise((resolve, reject) => {
      const url = new URL(webSocketUrl);
      const socket = net.createConnection(Number(url.port), url.hostname);
      const key = crypto.randomBytes(16).toString("base64");
      const timer = setTimeout(() => {
        socket.destroy();
        reject(new Error(`WebSocket handshake to ${webSocketUrl} timed out.`));
      }, timeoutMs);
      let handshake = "";

      socket.on("connect", () => {
        socket.write([
          `GET ${url.pathname}${url.search} HTTP/1.1`,
          `Host: ${url.host}`,
          "Upgrade: websocket",
          "Connection: Upgrade",
          `Sec-WebSocket-Key: ${key}`,
          "Sec-WebSocket-Version: 13",
          "",
          "",
        ].join("\r\n"));
      });

      socket.on("data", function onHandshake(chunk) {
        handshake += chunk.toString("binary");
        const end = handshake.indexOf("\r\n\r\n");
        if (end === -1) return;
        socket.off("data", onHandshake);
        clearTimeout(timer);
        const head = Buffer.from(handshake.slice(0, end), "binary").toString("utf8");
        if (!head.startsWith("HTTP/1.1 101")) {
          reject(new Error(`WebSocket handshake failed: ${head.split("\r\n")[0]}`));
          return;
        }
        const connection = new WebSocketConnection(socket);
        const rest = Buffer.from(handshake.slice(end + 4), "binary");
        if (rest.length) connection.receive(rest);
        resolve(connection);
      });

      socket.on("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
    });
  }

  send(method, params) {
    const id = this.nextId++;
    this.socket.write(encodeFrame(JSON.stringify({ id, method, params })));
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });
  }

  receive(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (this.buffer.length >= 2) {
      const parsed = decodeFrame(this.buffer);
      if (!parsed) return;
      this.buffer = this.buffer.subarray(parsed.bytes);
      if (parsed.opcode === 8) return;
      if (parsed.opcode !== 1) continue;
      let message;
      try {
        message = JSON.parse(parsed.payload.toString("utf8"));
      } catch {
        continue;
      }
      if (message.id && this.pending.has(message.id)) {
        const { resolve, reject } = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) reject(new Error(JSON.stringify(message.error)));
        else resolve(message.result);
      }
    }
  }

  close() {
    this.closed = true;
    this.socket.end();
  }
}

function encodeFrame(text) {
  const payload = Buffer.from(text, "utf8");
  const mask = crypto.randomBytes(4);
  let header;
  if (payload.length < 126) {
    header = Buffer.from([0x81, 0x80 | payload.length]);
  } else if (payload.length < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 0x80 | 126;
    header.writeUInt16BE(payload.length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x81;
    header[1] = 0x80 | 127;
    header.writeBigUInt64BE(BigInt(payload.length), 2);
  }
  const masked = Buffer.alloc(payload.length);
  for (let index = 0; index < payload.length; index += 1) {
    masked[index] = payload[index] ^ mask[index % 4];
  }
  return Buffer.concat([header, mask, masked]);
}

function decodeFrame(buffer) {
  const first = buffer[0];
  const second = buffer[1];
  let length = second & 0x7f;
  let offset = 2;
  if (length === 126) {
    if (buffer.length < 4) return null;
    length = buffer.readUInt16BE(2);
    offset = 4;
  } else if (length === 127) {
    if (buffer.length < 10) return null;
    length = Number(buffer.readBigUInt64BE(2));
    offset = 10;
  }
  if (buffer.length < offset + length) return null;
  return {
    opcode: first & 0x0f,
    payload: buffer.subarray(offset, offset + length),
    bytes: offset + length,
  };
}

module.exports = { WebSocketConnection };
