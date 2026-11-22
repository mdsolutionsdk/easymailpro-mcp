import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const BIN_PATH = join(__dirname, "..", "bin", "easymailpro-mcp.mjs");

function startMockServer(handler) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const chunks = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        const raw = Buffer.concat(chunks).toString("utf8");
        handler(req, raw, res);
      });
    });
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      resolve({
        server,
        url: `http://127.0.0.1:${addr.port}/mcp`,
        close: () => new Promise((r) => server.close(r)),
      });
    });
  });
}

function getClosedPortUrl() {
  return new Promise((resolve, reject) => {
    const server = http.createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      server.close(() => resolve(`http://127.0.0.1:${port}/mcp`));
    });
  });
}

function runBridge({ url, token, writeSteps }) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [BIN_PATH], {
      env: {
        ...process.env,
        EASYMAIL_MCP_URL: url,
        ...(token !== undefined ? { EASYMAIL_MCP_TOKEN: token } : {}),
      },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (d) => { stdout += d; });
    child.stderr.on("data", (d) => { stderr += d; });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));

    Promise.resolve()
      .then(() => writeSteps(child.stdin))
      .then(() => child.stdin.end())
      .catch((err) => {
        child.kill();
        reject(err);
      });
  });
}

test("forwards_jsonrpc_over_stdio_with_bearer_header", async () => {
  const received = [];
  const mock = await startMockServer((req, raw, res) => {
    received.push({
      method: req.method,
      auth: req.headers.authorization,
      contentType: req.headers["content-type"],
      accept: req.headers.accept,
      body: JSON.parse(raw),
    });
    const msg = JSON.parse(raw);
    const result =
      msg.method === "initialize"
        ? { protocolVersion: "2025-11-25", capabilities: { tools: {} }, serverInfo: { name: "EasyMail Pro", version: "1.2.0" } }
        : { tools: [{ name: "list_accounts" }] };
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result }));
  });

  try {
    const { code, stdout } = await runBridge({
      url: mock.url,
      token: "emp_mcp_test_secret",
      writeSteps: (stdin) => {
        stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-11-25" } }) + "\n");
        stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }) + "\n");
      },
    });
    assert.equal(code, 0);
    assert.equal(received.length, 2);
    assert.equal(received[0].method, "POST");
    assert.equal(received[0].auth, "Bearer emp_mcp_test_secret");
    assert.equal(received[1].auth, "Bearer emp_mcp_test_secret");

    // Exact newline-delimited JSON-RPC on stdout with zero extraneous bytes
    assert.ok(stdout.endsWith("\n"));
    const lines = stdout.slice(0, -1).split("\n");
    assert.equal(lines.length, 2);
    const r1 = JSON.parse(lines[0]);
    const r2 = JSON.parse(lines[1]);
    assert.equal(r1.id, 1);
    assert.equal(r1.result.protocolVersion, "2025-11-25");
    assert.equal(r2.id, 2);
    assert.deepEqual(r2.result.tools, [{ name: "list_accounts" }]);
  } finally {
    await mock.close();
  }
});

test("swallows_202_notifications_without_stdout", async () => {
  let hits = 0;
  const mock = await startMockServer((req, raw, res) => {
    hits += 1;
    const msg = JSON.parse(raw);
    if (msg.method === "notifications/initialized") {
      res.writeHead(202);
      res.end();
      return;
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { ok: true } }));
  });

  try {
    const { code, stdout } = await runBridge({
      url: mock.url,
      token: "emp_mcp_tok",
      writeSteps: (stdin) => {
        stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
        stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 7, method: "ping" }) + "\n");
      },
    });
    assert.equal(code, 0);
    assert.equal(hits, 2);
    const lines = stdout.trim().split("\n");
    assert.equal(lines.length, 1);
    assert.equal(JSON.parse(lines[0]).id, 7);
  } finally {
    await mock.close();
  }
});

test("returns_helpful_jsonrpc_error_on_econnrefused", async () => {
  const closedUrl = await getClosedPortUrl();
  const { code, stdout } = await runBridge({
    url: closedUrl,
    token: "emp_mcp_tok",
    writeSteps: (stdin) => {
      stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 3, method: "initialize" }) + "\n");
    },
  });
  assert.equal(code, 0);
  const lines = stdout.trim().split("\n");
  assert.equal(lines.length, 1);
  const resp = JSON.parse(lines[0]);
  assert.equal(resp.jsonrpc, "2.0");
  assert.equal(resp.id, 3);
  assert.ok(resp.error, "expected JSON-RPC error object");
  assert.match(resp.error.message, /https:\/\/easymailpro\.tech/);
});

test("returns_helpful_jsonrpc_error_on_401", async () => {
  const mock = await startMockServer((_req, _raw, res) => {
    res.writeHead(401, { "Content-Type": "application/json", "WWW-Authenticate": 'Bearer realm="easymailpro"' });
    res.end(JSON.stringify({ error: "unauthorized" }));
  });

  try {
    const { code, stdout } = await runBridge({
      url: mock.url,
      token: "wrong_token",
      writeSteps: (stdin) => {
        stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 4, method: "tools/list" }) + "\n");
      },
    });
    assert.equal(code, 0);
    const lines = stdout.trim().split("\n");
    assert.equal(lines.length, 1);
    const resp = JSON.parse(lines[0]);
    assert.equal(resp.jsonrpc, "2.0");
    assert.equal(resp.id, 4);
    assert.ok(resp.error, "expected JSON-RPC error object");
    assert.match(resp.error.message, /EASYMAIL_MCP_TOKEN/);
  } finally {
    await mock.close();
  }
});

test("handles_partial_chunked_stdin_lines", async () => {
  const mock = await startMockServer((_req, raw, res) => {
    const msg = JSON.parse(raw);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { pong: true } }));
  });

  try {
    const payload = JSON.stringify({ jsonrpc: "2.0", id: 9, method: "ping" }) + "\n";
    const mid = Math.floor(payload.length / 2);
    const { code, stdout } = await runBridge({
      url: mock.url,
      token: "emp_mcp_tok",
      writeSteps: async (stdin) => {
        stdin.write(payload.slice(0, mid));
        await new Promise((r) => setTimeout(r, 40));
        stdin.write(payload.slice(mid));
      },
    });
    assert.equal(code, 0);
    const lines = stdout.trim().split("\n");
    assert.equal(lines.length, 1);
    const resp = JSON.parse(lines[0]);
    assert.equal(resp.id, 9);
    assert.deepEqual(resp.result, { pong: true });
  } finally {
    await mock.close();
  }
});
