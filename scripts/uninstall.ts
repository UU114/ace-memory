import { aceLog } from '../shared/logger.js';
import { removeFromClaudeMd } from '../shared/claude-md.js';

function main(): void {
  try {
    removeFromClaudeMd(process.cwd());
    aceLog('Uninstalled. Your knowledge base in ~/.ace-claude/ has been preserved.');
  } catch (err) {
    aceLog(`Uninstall warning: ${err}`);
  }
}

main();
