---
description: Teach ACE new knowledge — patterns, tricks, pitfalls, preferences
allowed-tools: Bash, AskUserQuestion
---

# /learn — Teach ACE New Knowledge

Manually ingest knowledge into the ACE Playbook. Unlike automatic learning (which happens via hooks during normal sessions), `/learn` lets users explicitly tell ACE "remember this".

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
- Write a clear, actionable sentence. Prefix with `[Method]`, `[Trick]`, `[Pitfall]`, `[Preference]`, or `[Knowledge]`.
- Keep it under 200 characters.

### Step 5: Send to Daemon via IPC
Write a temporary JS file and execute it:

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

Replace `ENTRY_JSON_STRING` with the JSON-serialized entry and `PROJECT_NAME` with the project name.

### Step 6: Report Result
**On success**: Report added/merged/skipped counts.
**On daemon not running**: Tell user to restart Claude Code session.
**On other errors**: Show error message.
