const PREFIX = '[ACE]';

// Log to stderr (hooks use stdout for JSON output)
export function aceLog(msg: string): void {
  process.stderr.write(`${PREFIX} ${msg}\n`);
}

export function aceWarn(msg: string): void {
  process.stderr.write(`${PREFIX} WARN: ${msg}\n`);
}

export function aceError(msg: string): void {
  process.stderr.write(`${PREFIX} ERROR: ${msg}\n`);
}
