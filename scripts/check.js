const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const ignoredDirectories = new Set(['.git', 'node_modules']);

function collectJavaScriptFiles(directory) {
    const files = [];

    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        if (entry.isDirectory()) {
            if (!ignoredDirectories.has(entry.name)) {
                files.push(...collectJavaScriptFiles(path.join(directory, entry.name)));
            }
        } else if (entry.isFile() && entry.name.endsWith('.js')) {
            files.push(path.join(directory, entry.name));
        }
    }

    return files;
}

const files = collectJavaScriptFiles(root).sort();
let failed = false;

for (const file of files) {
    const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });

    if (result.status !== 0) {
        failed = true;
        process.stderr.write(result.stderr || `${file}: syntax check failed\n`);
    }
}

if (failed) process.exitCode = 1;
else console.log(`Syntax checked ${files.length} JavaScript files.`);
