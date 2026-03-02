import test from 'node:test';
import assert from 'node:assert';
import { getDiagnostics } from '../dist/tools/diagnostics.js';

test('Integration Test: getDiagnostics fallback', async (t) => {
    // We execute it on the repo-context-mcp root itself.
    // It should run tsc --noEmit since it's an npm project.
    const result = await getDiagnostics(process.cwd());
    
    assert.ok(result);
    assert.ok(result.command.includes('tsc') || result.command.includes('npm run'));
    // Depending on the project state it could have errors or not, but it shouldn't throw
    console.log(`Command detected: ${result.command}`);
    console.log(`Filtered out: ${result.filteredLines} lines of noise`);
    console.log(`Remaining errors: ${result.errorCount}`);
});
