# /learn — Teach ACE New Knowledge

## Overview
Manually ingest knowledge into the ACE Playbook. Unlike automatic learning (which happens via PostToolUse and Stop hooks during normal sessions), `/learn` lets users explicitly tell ACE "remember this" — patterns, tricks, pitfalls, preferences, or general knowledge.

## Usage
- `/learn` — Interactive mode: ask the user what they want ACE to remember.
- `/learn <description>` — Direct mode: process the provided knowledge immediately.

### Examples
- `/learn Always use bun instead of npm in this project`
- `/learn When you see ECONNRESET, retry with exponential backoff`
- `/learn Use vitest --watch for TDD workflow`
- `/learn Configure ESLint with the flat config format in new projects`

### Options
- `--scope <scope>` — Set the scope for the knowledge (default: auto-detected from project context)
  - `global` — Universal knowledge, applies everywhere
  - `project:<name>` — Project-specific knowledge
  - Example: `/learn --scope global Always use ESM instead of CommonJS`

## Execution Steps

When `/learn` is invoked, follow these steps exactly:

### Step 1: Understand the Knowledge
- If no argument was provided, ask the user: "What would you like ACE to remember?"
- Wait for their response before proceeding.
- If an argument was provided, use it directly as the knowledge to ingest.

### Step 2: Classify the Knowledge
Determine the **pattern_type** based on the content:
| Content is about...              | pattern_type      |
|----------------------------------|-------------------|
| An error, bug fix, or workaround | `error_fix`       |
| A coding pattern or convention   | `code_pattern`    |
| A command, tool, or CLI usage    | `command_usage`   |
| File creation or project setup   | `file_creation`   |

Determine the **knowledge_type** (used by the Reflector for bullet classification):
| Category       | When to use                                                  |
|----------------|--------------------------------------------------------------|
| **Method**     | A standard approach or technique for doing something         |
| **Trick**      | A clever shortcut or non-obvious efficiency tip              |
| **Pitfall**    | A warning about something that causes bugs or confusion      |
| **Preference** | A user or project preference (style, tooling, conventions)   |
| **Knowledge**  | General factual knowledge or context                         |

### Step 2.5: Check for --scope Flag
- If the user included `--scope <value>` in their command, extract and remove it from the content.
- Valid values: `global`, `project:<name>`.
- If provided, this scope will override the auto-detected scope when sending to the daemon.
- If not provided, scope will be auto-detected by the Reflector based on file context.

### Step 3: Determine the Project Name
The project name is the basename of the current working directory. Use the Bash tool:
```bash
basename "$(pwd)"
```

### Step 4: Format as SessionQueueEntry
Construct a JSON object matching this structure:
```json
{
  "timestamp": "<current ISO 8601 timestamp>",
  "tool_name": "manual",
  "pattern_type": "<error_fix | code_pattern | command_usage | file_creation>",
  "summary": "<concise distilled summary of the knowledge>",
  "context": {
    "language": "<programming language if applicable, otherwise omit>",
    "file": "<relevant file path if applicable, otherwise omit>"
  },
  "processed": false
}
```

Guidelines for the `summary` field:
- Write a clear, actionable sentence. It should read like an instruction or rule.
- Prefix with the knowledge type in brackets: `[Method]`, `[Trick]`, `[Pitfall]`, `[Preference]`, or `[Knowledge]`.
- Keep it under 200 characters.
- Example: `[Preference] Always use bun instead of npm for package management in this project.`
- Example: `[Pitfall] When encountering ECONNRESET errors, retry the request with exponential backoff.`
- Example: `[Trick] Use vitest --watch for a TDD workflow with instant feedback.`
- Example: `[Method] Configure ESLint using the flat config format (eslint.config.js) in new projects.`

### Step 5: Send to Daemon via IPC
Use the Bash tool to run a Node.js inline script that sends a JSON-RPC 2.0 request to the daemon. Replace `ENTRY_JSON_STRING` with the JSON-serialized entry (escaped for embedding in a JS string) and `PROJECT_NAME` with the project name from Step 3.

The daemon listens on a named pipe (Windows) or Unix socket. The protocol is newline-delimited JSON-RPC 2.0.

Write a temporary JS file and execute it. This avoids shell-escaping issues with inline `node -e`:

```bash
cat > /tmp/ace-learn-send.js << 'SCRIPT'
const net = require('net');
const os = require('os');
const path = require('path');
const socketPath = process.platform === 'win32'
  ? '\\\\.\\pipe\\ace-claude-daemon'
  : path.join(os.homedir(), '.ace-claude', 'daemon.sock');
const entry = JSON.parse(process.argv[2]);
const project = process.argv[3];
const request = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'curate', params: { insights: [entry], project } }) + '\n';
const socket = net.createConnection({ path: socketPath });
let buf = '';
const timeout = setTimeout(() => { socket.destroy(); console.log(JSON.stringify({ error: 'IPC timeout' })); process.exit(1); }, 10000);
socket.on('connect', () => socket.write(request));
socket.on('data', (chunk) => {
  buf += chunk.toString();
  const lines = buf.split('\n');
  for (const line of lines) {
    if (line.trim()) {
      clearTimeout(timeout);
      const resp = JSON.parse(line);
      console.log(JSON.stringify(resp.result || { error: (resp.error && resp.error.message) || 'Unknown error' }));
      socket.destroy();
    }
  }
});
socket.on('error', () => {
  clearTimeout(timeout);
  console.log(JSON.stringify({ error: 'Daemon not running. Start a new Claude Code session to auto-start the daemon.' }));
  process.exit(1);
});
SCRIPT
node /tmp/ace-learn-send.js 'ENTRY_JSON_STRING' 'PROJECT_NAME'
```

Replace `ENTRY_JSON_STRING` with the JSON-serialized entry (single-quoted to avoid bash interpretation) and `PROJECT_NAME` with the project name from Step 3.

This script runs from any directory -- it does not depend on the plugin's `dist/` path.

### Step 6: Report Result
Parse the JSON output from Step 5 and report to the user:

**On success** (result contains `added`, `merged`, `skipped`):
```
Learned! ACE has ingested your knowledge:
- Type: [knowledge_type]
- Category: [pattern_type]
- Summary: [the summary you wrote]
- Result: [added] added, [merged] merged, [skipped] skipped
```

**On daemon not running** (result contains `error` mentioning daemon):
```
The ACE daemon is not running. Knowledge could not be ingested.
Start a new Claude Code session to auto-start the daemon, then try /learn again.
```

**On other errors**:
```
Failed to ingest knowledge: [error message]
Please check that the ACE plugin is installed and the daemon is running.
```

## Reference: Full Examples

### Example 1: Preference
User says: `/learn Always use bun instead of npm in this project`
```json
{
  "timestamp": "2026-02-27T10:30:00.000Z",
  "tool_name": "manual",
  "pattern_type": "command_usage",
  "summary": "[Preference] Always use bun instead of npm for package management in this project.",
  "context": {},
  "processed": false
}
```

### Example 2: Pitfall
User says: `/learn When you see ECONNRESET, retry with exponential backoff`
```json
{
  "timestamp": "2026-02-27T10:31:00.000Z",
  "tool_name": "manual",
  "pattern_type": "error_fix",
  "summary": "[Pitfall] When encountering ECONNRESET errors, retry the request with exponential backoff.",
  "context": {
    "error_message": "ECONNRESET"
  },
  "processed": false
}
```

### Example 3: Trick
User says: `/learn Use vitest --watch for TDD workflow`
```json
{
  "timestamp": "2026-02-27T10:32:00.000Z",
  "tool_name": "manual",
  "pattern_type": "command_usage",
  "summary": "[Trick] Use vitest --watch for a TDD workflow with instant feedback.",
  "context": {
    "command": "vitest --watch"
  },
  "processed": false
}
```

### Example 4: Method
User says: `/learn Configure ESLint with the flat config format in new projects`
```json
{
  "timestamp": "2026-02-27T10:33:00.000Z",
  "tool_name": "manual",
  "pattern_type": "file_creation",
  "summary": "[Method] Configure ESLint using the flat config format (eslint.config.js) in new projects.",
  "context": {
    "file": "eslint.config.js"
  },
  "processed": false
}
```

### Example 5: Knowledge
User says: `/learn The database connection pool max size is 20 in production`
```json
{
  "timestamp": "2026-02-27T10:34:00.000Z",
  "tool_name": "manual",
  "pattern_type": "code_pattern",
  "summary": "[Knowledge] The database connection pool max size is 20 in production.",
  "context": {},
  "processed": false
}
```
