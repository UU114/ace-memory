import { aceError } from '../shared/logger.js';
import { sessionStartMain } from './session-start-core.js';

// Entry point: run main and ensure stdout always gets '{}'
sessionStartMain().catch((err) => {
  aceError(`SessionStart fatal: ${err}`);
  process.stdout.write('{}');
});
