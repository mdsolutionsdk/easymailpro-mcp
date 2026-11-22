#!/usr/bin/env node
/**
 * easymailpro-mcp — Zero-dependency stdio-to-Streamable-HTTP bridge for EasyMail Pro.
 *
 * Reads newline-delimited JSON-RPC 2.0 messages from stdin, forwards each to
 * EasyMail Pro's local loopback MCP endpoint, and writes single-line JSON-RPC
 * responses to stdout. All diagnostics go strictly to stderr.
 */
import readline from "node:readline";

const DEFAULT_URL = "http://127.0.0.1:41280/mcp";
const ENDPOINT_URL = (process.env.EASYMAIL_MCP_URL || "").trim() || DEFAULT_URL;
const TOKEN = (process.env.EASYMAIL_MCP_TOKEN || "").trim();

const NOT_RUNNING_MSG =
  "EasyMail Pro is not running or its MCP server is disabled. Open EasyMail Pro -> Settings -> MCP Server, or download EasyMail Pro at https://easymailpro.tech";
const AUTH_ERROR_MSG =
  "Invalid or missing EASYMAIL_MCP_TOKEN. Copy the current token from EasyMail Pro -> Settings -> MCP Server.";

function writeStdoutJson(obj) {
  process.stdout.write(`${JSON.stringify(obj)}\n`);
}

function writeJsonRpcError(id, code, message) {
  if (id === undefined) {
    process.stderr.write(`[easymailpro-mcp] ${message}\n`);
    return;
  }
  writeStdoutJson({
    jsonrpc: "2.0",
    id,
    error: { code, message },
  });
}

async function forwardMessage(rawLine) {
  let msg;
  try {
    msg = JSON.parse(rawLine);
  } catch (err) {
    writeJsonRpcError(null, -32700, `Invalid JSON-RPC message: ${err.message}`);
    return;
  }

  const hasId =
    msg !== null &&
    typeof msg === "object" &&
    Object.prototype.hasOwnProperty.call(msg, "id");
  const id = hasId ? msg.id : undefined;

  if (!TOKEN) {
    writeJsonRpcError(id, -32001, AUTH_ERROR_MSG);
    return;
  }

  let res;
  try {
    res = await fetch(ENDPOINT_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: `Bearer ${TOKEN}`,
      },
      body: JSON.stringify(msg),
    });
  } catch (err) {
    process.stderr.write(`[easymailpro-mcp] connection failed (${ENDPOINT_URL}): ${err?.message || err}\n`);
    writeJsonRpcError(id, -32000, NOT_RUNNING_MSG);
    return;
  }

  if (res.status === 202 || res.status === 204) {
    // Notification accepted — do not emit anything to stdout.
    return;
  }

  if (res.status === 401) {
    writeJsonRpcError(id, -32001, AUTH_ERROR_MSG);
    return;
  }

  const text = await res.text();
  if (!res.ok) {
    const detail = text ? `: ${text.slice(0, 300)}` : "";
    writeJsonRpcError(id, -32000, `EasyMail Pro MCP HTTP ${res.status}${detail}`);
    return;
  }

  if (!text.trim()) {
    return;
  }

  try {
    const parsed = JSON.parse(text);
    writeStdoutJson(parsed);
  } catch (err) {
    process.stderr.write(`[easymailpro-mcp] invalid JSON response from server: ${err.message}\n`);
    writeJsonRpcError(id, -32603, "Invalid JSON response from EasyMail Pro MCP server.");
  }
}

async function main() {
  const rl = readline.createInterface({
    input: process.stdin,
    crlfDelay: Infinity,
  });

  // Process lines sequentially so stdout preserves strict request order and
  // stdin EOF waits for every in-flight fetch to complete before exit.
  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    await forwardMessage(trimmed);
  }
}

main().catch((err) => {
  process.stderr.write(`[easymailpro-mcp] fatal: ${err?.stack || err}\n`);
  process.exitCode = 1;
});
