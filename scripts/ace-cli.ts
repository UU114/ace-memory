import { AceDatabase } from '../storage/sqlite.js';
import { loadConfig, saveConfig } from '../shared/config-loader.js';
import { getDbPath, getPidPath, getModelsDir } from '../shared/platform.js';
import { IPCClient } from '../shared/ipc-client.js';
import { Generator } from '../engine/generator.js';
import { Exporter, type ExportFormat } from '../engine/exporter.js';
import { Importer } from '../engine/importer.js';
import { Curator } from '../engine/curator.js';
import fs from 'fs';

// Output JSON result to stdout
function output(data: unknown): void {
  console.log(JSON.stringify(data, null, 2));
}

// Extract --flag value from args array
function getFlag(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  if (idx === -1 || idx + 1 >= args.length) return undefined;
  return args[idx + 1];
}

// Check if --flag exists in args
function hasFlag(args: string[], flag: string): boolean {
  return args.includes(flag);
}

// Show Playbook statistics
export async function statusCmd(): Promise<void> {
  const db = new AceDatabase(getDbPath());
  try {
    const stats = db.getStats();
    output(stats);
  } finally {
    db.close();
  }
}

// Search bullets by keyword query
export async function searchCmd(query: string): Promise<void> {
  if (!query.trim()) {
    output({ error: 'Search query is required' });
    process.exit(1);
  }

  const db = new AceDatabase(getDbPath());
  try {
    const bullets = db.queryBullets({});
    const generator = new Generator();
    const results = generator.keywordSearch(query, bullets, 10);
    output(
      results.map(r => ({
        id: r.bullet.id,
        content: r.bullet.content,
        scope: r.bullet.scope,
        section: r.bullet.section,
        knowledge_type: r.bullet.knowledge_type,
        finalScore: r.finalScore,
      })),
    );
  } finally {
    db.close();
  }
}

// Show or update configuration
export async function configCmd(args: string[]): Promise<void> {
  if (args.length === 0) {
    const config = loadConfig();
    output(config);
    return;
  }

  if (args[0] === 'set' && args.length >= 3) {
    const key = args[1];
    const rawValue = args.slice(2).join(' ');

    // Parse the value: try number, then boolean, then string
    let value: unknown;
    if (rawValue === 'true') value = true;
    else if (rawValue === 'false') value = false;
    else if (!isNaN(Number(rawValue)) && rawValue.trim() !== '') value = Number(rawValue);
    else value = rawValue;

    const config = loadConfig();

    // Apply dot-notation key to config object
    const keys = key.split('.');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let target: any = config;
    for (let i = 0; i < keys.length - 1; i++) {
      if (target[keys[i]] === undefined || typeof target[keys[i]] !== 'object') {
        output({ error: `Invalid config key: ${key}` });
        process.exit(1);
      }
      target = target[keys[i]];
    }

    const lastKey = keys[keys.length - 1];
    if (target[lastKey] === undefined) {
      output({ error: `Invalid config key: ${key}` });
      process.exit(1);
    }

    target[lastKey] = value;
    saveConfig(config);
    output({ updated: key, value });
    return;
  }

  output({ error: 'Usage: config OR config set <key> <value>' });
  process.exit(1);
}

// Check daemon and system health
export async function healthCmd(): Promise<void> {
  const pidPath = getPidPath();
  const pidExists = fs.existsSync(pidPath);

  let daemonStatus = 'stopped';
  let ipcStatus = 'unreachable';

  if (pidExists) {
    daemonStatus = 'running';
  }

  // Try IPC ping with 2s timeout
  try {
    const client = await IPCClient.connect(2000);
    if (client) {
      try {
        await client.call('ping', {}, 2000);
        ipcStatus = 'connected';
      } catch {
        ipcStatus = 'unreachable';
      } finally {
        client.disconnect();
      }
    }
  } catch {
    ipcStatus = 'unreachable';
  }

  // Check ONNX model directory
  const modelsDir = getModelsDir();
  const onnxStatus = fs.existsSync(modelsDir) ? 'available' : 'missing';

  output({
    daemon: daemonStatus,
    ipc: ipcStatus,
    onnx: onnxStatus,
    pidFile: pidExists,
  });
}

// List and resolve conflicts
export async function conflictsCmd(args: string[]): Promise<void> {
  const db = new AceDatabase(getDbPath());
  try {
    if (args[0] === 'resolve' && args[1]) {
      const id = args[1];
      const action = args[2] || 'keep_both'; // keep_a | keep_b | keep_both

      const conflicts = db.getConflicts();
      const conflict = conflicts.find(c => c.id === id);
      if (!conflict) {
        output({ error: `Conflict ${id} not found` });
        return;
      }

      if (action === 'keep_a') {
        db.archiveBullet(conflict.bullet_id_b);
      } else if (action === 'keep_b') {
        db.archiveBullet(conflict.bullet_id_a);
      }
      // keep_both: no archiving

      db.resolveConflict(id);
      output({ resolved: id, action });
      return;
    }

    // List unresolved conflicts
    const conflicts = db.getConflicts(false);
    output(
      conflicts.map(c => ({
        id: c.id,
        type: c.conflict_type,
        description: c.description,
        created_at: c.created_at,
      })),
    );
  } finally {
    db.close();
  }
}

// Export bullets in various formats (JSON, Markdown) with optional scope filtering
export async function exportCmd(args: string[] = []): Promise<void> {
  const format = (getFlag(args, '--format') || 'raw') as ExportFormat | 'raw';
  const scope = getFlag(args, '--scope');
  const outputPath = getFlag(args, '--output');
  const config = loadConfig();

  const db = new AceDatabase(getDbPath());
  try {
    // Backward compat: no args = raw JSON array (original behavior)
    if (format === 'raw' && !scope && !outputPath) {
      const bullets = db.queryBullets({});
      output(bullets);
      return;
    }

    const exporter = new Exporter(db);
    const result = exporter.export({
      format: format === 'raw' ? 'json' : format,
      scope,
      projectName: config.project_name,
    });

    if (outputPath) {
      fs.writeFileSync(outputPath, result, 'utf-8');
      output({ exported: outputPath, format });
    } else {
      // For structured formats, output as-is (already formatted)
      console.log(result);
    }
  } finally {
    db.close();
  }
}

// Import bullets from a JSON export file
export async function importCmd(args: string[] = []): Promise<void> {
  const filePath = args[0];
  if (!filePath) {
    output({ error: 'Usage: import <file.json>' });
    process.exit(1);
  }

  const db = new AceDatabase(getDbPath());
  try {
    const curator = new Curator(db, null);
    const importer = new Importer(db, curator, null);
    const result = await importer.importFromFile(filePath);
    output(result);
  } finally {
    db.close();
  }
}

// List projects (scopes) and their statistics
export async function projectsCmd(args: string[]): Promise<void> {
  const db = new AceDatabase(getDbPath());
  try {
    const scopeArg = args[0];

    if (scopeArg) {
      // Show bullets for a specific scope
      const bullets = db.getBulletsByScope(scopeArg);
      output(
        bullets.map(b => ({
          id: b.id,
          content: b.content,
          knowledge_type: b.knowledge_type,
          instructivity_score: b.instructivity_score,
          decay_weight: b.decay_weight,
        })),
      );
      return;
    }

    // List all scopes with stats
    const stats = db.getProjectStats();
    output(stats);
  } finally {
    db.close();
  }
}

// Promote bullets from project scope to global
export async function promoteCmd(args: string[]): Promise<void> {
  const scope = args[0];
  if (!scope) {
    output({ error: 'Usage: promote <scope> [--all | --min-score <N> | --id <bullet_id>]' });
    process.exit(1);
  }

  if (scope === 'global') {
    output({ error: 'Cannot promote from global (already global)' });
    return;
  }

  const db = new AceDatabase(getDbPath());
  try {
    const bulletId = getFlag(args, '--id');
    const minScoreStr = getFlag(args, '--min-score');
    const all = hasFlag(args, '--all');

    if (bulletId) {
      // Single bullet promote
      const bullet = db.getBulletById(bulletId);
      if (!bullet) {
        output({ error: `Bullet ${bulletId} not found` });
        return;
      }
      if (bullet.scope === 'global') {
        output({ error: 'Bullet is already global' });
        return;
      }
      db.updateBulletScope(bulletId, 'global');
      output({ promoted: 1, scope, newScope: 'global' });
      return;
    }

    const minScore = minScoreStr ? parseInt(minScoreStr, 10) : undefined;
    const bullets = db.getBulletsByScope(scope, { minScore });

    if (!all && !minScoreStr) {
      // List mode: show bullets for review
      output(
        bullets.map(b => ({
          id: b.id,
          content: b.content,
          knowledge_type: b.knowledge_type,
          instructivity_score: b.instructivity_score,
        })),
      );
      return;
    }

    if (bullets.length === 0) {
      output({ promoted: 0, message: 'No bullets to promote' });
      return;
    }

    // Batch promote
    let promoted = 0;
    for (const b of bullets) {
      db.updateBulletScope(b.id, 'global');
      promoted++;
    }
    output({ promoted, scope, newScope: 'global' });
  } finally {
    db.close();
  }
}

// Clear all bullets from the Playbook
export async function clearCmd(): Promise<void> {
  const db = new AceDatabase(getDbPath());
  try {
    const stats = db.getStats();
    const total = stats.total;
    // Delete all bullets by querying and removing each
    const bullets = db.queryBullets({});
    for (const bullet of bullets) {
      db.deleteBullet(bullet.id);
    }
    output({ cleared: total });
  } finally {
    db.close();
  }
}

// Main entry point
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0] || 'status';

  switch (command) {
    case 'status':
      return statusCmd();
    case 'search':
      return searchCmd(args.slice(1).join(' '));
    case 'config':
      return configCmd(args.slice(1));
    case 'health':
      return healthCmd();
    case 'conflicts':
      return conflictsCmd(args.slice(1));
    case 'export':
      return exportCmd(args.slice(1));
    case 'import':
      return importCmd(args.slice(1));
    case 'projects':
      return projectsCmd(args.slice(1));
    case 'promote':
      return promoteCmd(args.slice(1));
    case 'clear':
      return clearCmd();
    default:
      output({ error: `Unknown command: ${command}` });
      process.exit(1);
  }
}

// Only run main() when executed directly (not when imported for testing)
if (require.main === module) {
  main().catch(err => {
    output({ error: err instanceof Error ? err.message : String(err) });
    process.exit(1);
  });
}
