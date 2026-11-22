# @easymailpro/mcp

Official `stdio`-to-Streamable-HTTP bridge for the built-in local MCP (Model Context Protocol) server in [EasyMail Pro](https://easymailpro.tech).

Connect Claude Desktop, Claude Code, OpenAI Codex, OpenCode, Cursor, VS Code, Windsurf, Cline, or any MCP-compatible AI agent directly to your local EasyMail Pro mailbox — zero cloud relay, zero third-party OAuth tokens, and all email stays on your machine.

- **npm package:** [`@easymailpro/mcp`](https://www.npmjs.com/package/@easymailpro/mcp)
- **Official MCP Registry ID:** `tech.easymailpro/easymailpro`
- **Dependencies:** 0 (Node.js >= 20 built-in `fetch` and `node:readline`)
- **Download EasyMail Pro:** [https://easymailpro.tech](https://easymailpro.tech)

## Prerequisites

1. Install and open [EasyMail Pro](https://easymailpro.tech) (v1.2.1 or newer).
2. Open **Settings -> MCP Server** and enable the local MCP server.
3. Choose your access level:
   - **Read-only** (default) — 14 tools for searching, listing, reading messages/threads, extracting PDF/DOCX/XLSX/text attachments, inspecting accounts/folders/VIPs/templates/follow-ups, and syncing.
   - **Read and write (Full access)** — all 28 tools, adding drafts, immediate/scheduled send, archive, trash, star, snooze, mark read/unread, move, folder management, VIPs, Split Inbox categories, templates, and follow-up dismissal.
4. Copy your personal Bearer access token (`EASYMAIL_MCP_TOKEN`).

> **Direct HTTP vs. `@easymailpro/mcp` bridge:** Clients with native Streamable HTTP support (Claude Code, Codex, OpenCode, Cursor) can connect directly to `http://127.0.0.1:41280/mcp` with no bridge needed. Use `npx -y @easymailpro/mcp` for `stdio`-based clients like Claude Desktop or MCP registries that launch npm packages over `stdio`.

## Client Setup

### Claude Desktop (`claude_desktop_config.json`)

```json
{
  "mcpServers": {
    "easymailpro": {
      "command": "npx",
      "args": ["-y", "@easymailpro/mcp"],
      "env": {
        "EASYMAIL_MCP_TOKEN": "YOUR_TOKEN_HERE"
      }
    }
  }
}
```

If you changed the default port (`41280`), also set `EASYMAIL_MCP_URL` (for example `"http://127.0.0.1:41281/mcp"`).

### Claude Code (direct Streamable HTTP)

```bash
claude mcp add --transport http --scope user easymailpro http://127.0.0.1:41280/mcp --header "Authorization: Bearer YOUR_TOKEN_HERE"
```

### OpenAI Codex (`~/.codex/config.toml`)

```toml
[mcp_servers.easymailpro]
url = "http://127.0.0.1:41280/mcp"

[mcp_servers.easymailpro.http_headers]
Authorization = "Bearer YOUR_TOKEN_HERE"
```

### OpenCode (`opencode.json`)

```json
{
  "mcp": {
    "easymailpro": {
      "type": "remote",
      "url": "http://127.0.0.1:41280/mcp",
      "oauth": false,
      "headers": {
        "Authorization": "Bearer YOUR_TOKEN_HERE"
      }
    }
  }
}
```

### Cursor (`~/.cursor/mcp.json`)

```json
{
  "mcpServers": {
    "easymailpro": {
      "url": "http://127.0.0.1:41280/mcp",
      "headers": {
        "Authorization": "Bearer YOUR_TOKEN_HERE"
      }
    }
  }
}
```

## Environment Variables

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `EASYMAIL_MCP_TOKEN` | Yes | — | Bearer token from EasyMail Pro -> Settings -> MCP Server |
| `EASYMAIL_MCP_URL` | No | `http://127.0.0.1:41280/mcp` | Local EasyMail Pro MCP endpoint URL |

## Capabilities

- **MCP Protocol:** Dual-era Streamable HTTP (`2025-03-26`..`2025-11-25` `initialize` + `2026-07-28` `server/discover`), `ToolAnnotations`, and `structuredContent`.
- **28 Tools:** 14 read-only + 14 write tools (strictly gated by your selected access level in EasyMail Pro).
- **5 Resources:** `easymail://accounts`, `easymail://folders`, `easymail://templates`, `easymail://thread/{id}`, `easymail://message/{id}`.
- **3 Prompts:** `triage_inbox`, `draft_reply`, `daily_briefing`.

## Security Model

- EasyMail Pro binds exclusively to `127.0.0.1` (loopback only).
- Requests with a browser `Origin` header or non-loopback `Host` header are rejected (`403 Forbidden`).
- Constant-time Bearer token validation (`401 Unauthorized` on mismatch), stored only in EasyMail Pro's encrypted local vault.
- Destructive operations (permanent Trash expunge, deleting built-in or non-empty folders) are blocked even in Full access mode.
- Bulk mutations are capped at 100 messages per call, and untrusted email/attachment bodies are wrapped in explicit `<email_content>` / `<attachment_content>` delimiters.

## License

MIT
