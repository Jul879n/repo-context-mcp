#!/usr/bin/env node

if (process.argv.includes('--setup')) {
	import('../dist/cli/setup.js');
} else {
	import('../dist/index.js');
}
