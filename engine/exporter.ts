import type { Bullet } from '../types/bullet.js';
import type { AceDatabase } from '../storage/sqlite.js';

// Versioned export format
export interface ExportData {
  export_version: number;
  exported_at: string;
  source_project: string;
  bullet_count: number;
  bullets: ExportedBullet[];
}

// Bullet without embedding (saves space, recomputed on import)
export type ExportedBullet = Omit<Bullet, 'embedding'>;

export type ExportFormat = 'json' | 'markdown';

export class Exporter {
  constructor(private db: AceDatabase) {}

  // Export bullets in the requested format
  export(
    options: {
      format?: ExportFormat;
      scope?: string;
      projectName?: string;
    } = {},
  ): string {
    const format = options.format ?? 'json';

    const bullets = options.scope
      ? this.db.queryBullets({ scopes: [options.scope] })
      : this.db.queryBullets({});

    if (format === 'markdown') {
      return this.formatMarkdown(bullets, options.projectName);
    }

    return this.formatJson(bullets, options.projectName);
  }

  private formatJson(bullets: Bullet[], projectName?: string): string {
    const data: ExportData = {
      export_version: 1,
      exported_at: new Date().toISOString(),
      source_project: projectName ?? 'unknown',
      bullet_count: bullets.length,
      bullets: bullets.map(b => this.stripEmbedding(b)),
    };
    return JSON.stringify(data, null, 2);
  }

  private formatMarkdown(bullets: Bullet[], projectName?: string): string {
    const lines: string[] = [];
    lines.push('# ACE Playbook Export');
    lines.push(
      `> Exported: ${new Date().toISOString().split('T')[0]} | Bullets: ${bullets.length}${projectName ? ` | Project: ${projectName}` : ''}`,
    );
    lines.push('');

    // Group by section
    const bySection = new Map<string, Bullet[]>();
    for (const b of bullets) {
      if (!bySection.has(b.section)) bySection.set(b.section, []);
      bySection.get(b.section)!.push(b);
    }

    for (const [section, sectionBullets] of bySection) {
      lines.push(
        `## ${section.charAt(0).toUpperCase() + section.slice(1)}`,
      );
      for (const b of sectionBullets) {
        const scoreInfo = `score: ${b.instructivity_score}, recalled ${b.recall_count}x`;
        const content = b.content.replace(/([|#])/g, '\\$1');
        lines.push(
          `- **[${b.knowledge_type}]** ${content} (${scoreInfo})`,
        );
        if (b.code_content) {
          lines.push(
            `  > \`${b.code_content.replace(/\n/g, ' ')}\``,
          );
        }
      }
      lines.push('');
    }

    return lines.join('\n');
  }

  private stripEmbedding(bullet: Bullet): ExportedBullet {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { embedding, ...rest } = bullet;
    return rest;
  }
}
