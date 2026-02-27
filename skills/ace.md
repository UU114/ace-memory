# /ace — ACE Playbook Manager

## Overview
Manage your ACE (Adaptive Context Engine) knowledge Playbook. View stats, search bullets, manage configuration, check daemon health, export data, or clear the Playbook.

## Usage
`/ace <subcommand> [args]`

### Subcommands
- `/ace status` — Show Playbook statistics (total bullets, breakdown by scope, type, and section, daemon status)
- `/ace search <query>` — Search bullets matching a keyword query (returns up to 10 results)
- `/ace config` — Show the current ACE configuration
- `/ace config set <key> <value>` — Update a config value using dot notation (e.g., `decay.half_life_days 60`)
- `/ace health` — Check daemon health, IPC connectivity, and ONNX model availability
- `/ace export` — Export the entire Playbook as a JSON array of bullets
- `/ace clear` — Clear all bullets from the Playbook (destructive, confirm with the user first)

## How to Execute
When the user invokes `/ace <subcommand>`, run the ace-cli tool using the Bash tool:
```
node "dist/scripts/ace-cli.js" <subcommand> [args]
```
Parse the JSON output and present it in a readable format to the user.

## Subcommand Details

### status
Returns JSON with fields: `total`, `byScope`, `byType`, `bySection`.
Present as a formatted summary table or bullet list.

### search \<query\>
Pass the query string after the subcommand. Returns a JSON array of matching bullets with `id`, `content`, `scope`, `section`, `knowledge_type`, `finalScore`.
Present results as a numbered list showing content and score.

### config
With no extra arguments, returns the full current configuration as JSON.
Present it in a readable nested format.

### config set \<key\> \<value\>
Use dot notation for nested keys (e.g., `decay.half_life_days`).
The CLI will update the config and return `{ "updated": "<key>", "value": <value> }`.
Confirm the change to the user.

### health
Returns JSON with fields: `daemon` (running/stopped), `ipc` (connected/unreachable), `onnx` (available/missing), `pidFile` (boolean).
Present as a health checklist.

### export
Returns the full Playbook as a JSON array. This can be large.
Offer to save to a file or display a summary count.

### clear
**IMPORTANT**: Before running this command, always ask the user for confirmation. This deletes all bullets permanently.
Returns `{ "cleared": N }` where N is the number of deleted bullets.
