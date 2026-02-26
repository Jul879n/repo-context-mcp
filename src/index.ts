#!/usr/bin/env node

export * from './types/index.js';
export * from './tools/index.js';
export { createServer, main } from './server.js';

// Run the server when executed directly
import { main } from './server.js';

main().catch((error) => {
  console.error('Failed to start repo-context-mcp server:', error);
  process.exit(1);
});
