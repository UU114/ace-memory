import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    'hooks/session-start': 'hooks/session-start.ts',
    'hooks/user-prompt-submit': 'hooks/user-prompt-submit.ts',
    'hooks/post-tool-use': 'hooks/post-tool-use.ts',
    'hooks/stop': 'hooks/stop.ts',
    'hooks/session-end': 'hooks/session-end.ts',
    'daemon/index': 'daemon/index.ts',
    'scripts/ace-cli': 'scripts/ace-cli.ts',
    'scripts/setup': 'scripts/setup.ts',
    'scripts/install': 'scripts/install.ts',
  },
  format: ['cjs'],
  target: 'node18',
  clean: true,
  external: ['better-sqlite3', 'onnxruntime-node'],
});
