import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { injectClaudeMd, removeFromClaudeMd } from '../../shared/claude-md.js';

describe('claude-md inject/remove', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = path.join(os.tmpdir(), `ace-install-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    fs.mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('creates CLAUDE.md with ACE block when file does not exist', () => {
    injectClaudeMd(tmpDir);

    const content = fs.readFileSync(path.join(tmpDir, 'CLAUDE.md'), 'utf-8');
    expect(content).toContain('<!-- ACE_MEMORY_START -->');
    expect(content).toContain('<!-- ACE_MEMORY_END -->');
    expect(content).toContain('ACE Memory Integration');
  });

  it('appends ACE block to existing CLAUDE.md', () => {
    const existing = '# My Project\n\nSome instructions here.\n';
    fs.writeFileSync(path.join(tmpDir, 'CLAUDE.md'), existing, 'utf-8');

    injectClaudeMd(tmpDir);

    const content = fs.readFileSync(path.join(tmpDir, 'CLAUDE.md'), 'utf-8');
    // Original content preserved
    expect(content).toContain('# My Project');
    expect(content).toContain('Some instructions here.');
    // ACE block appended
    expect(content).toContain('<!-- ACE_MEMORY_START -->');
  });

  it('is idempotent - skips injection when marker already exists', () => {
    injectClaudeMd(tmpDir);
    const firstContent = fs.readFileSync(path.join(tmpDir, 'CLAUDE.md'), 'utf-8');

    injectClaudeMd(tmpDir);
    const secondContent = fs.readFileSync(path.join(tmpDir, 'CLAUDE.md'), 'utf-8');

    expect(secondContent).toBe(firstContent);
  });

  it('removes ACE block and preserves other content', () => {
    const existing = '# My Project\n\nSome instructions here.\n';
    fs.writeFileSync(path.join(tmpDir, 'CLAUDE.md'), existing, 'utf-8');
    injectClaudeMd(tmpDir);

    removeFromClaudeMd(tmpDir);

    const content = fs.readFileSync(path.join(tmpDir, 'CLAUDE.md'), 'utf-8');
    expect(content).toContain('# My Project');
    expect(content).not.toContain('<!-- ACE_MEMORY_START -->');
    expect(content).not.toContain('<!-- ACE_MEMORY_END -->');
  });

  it('deletes CLAUDE.md when only ACE content remains', () => {
    injectClaudeMd(tmpDir);
    removeFromClaudeMd(tmpDir);

    expect(fs.existsSync(path.join(tmpDir, 'CLAUDE.md'))).toBe(false);
  });

  it('removeFromClaudeMd is safe when no CLAUDE.md exists', () => {
    // Should not throw
    removeFromClaudeMd(tmpDir);
  });
});
