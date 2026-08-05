const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const projectRoot = path.resolve(__dirname, '..', '..');
const roots = [path.join(projectRoot, 'backend'), path.join(projectRoot, 'frontend', 'assets', 'js')];
const files = [];

const walk = directory => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        if (entry.name === 'node_modules') continue;
        const full = path.join(directory, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.isFile() && entry.name.endsWith('.js')) files.push(full);
    }
};

for (const root of roots) if (fs.existsSync(root)) walk(root);

let failures = 0;
for (const file of files.sort()) {
    const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
    if (result.status !== 0) {
        failures += 1;
        console.error(`Syntax check failed: ${path.relative(projectRoot, file)}`);
        console.error(result.stderr || result.stdout);
    }
}

if (failures) {
    console.error(`${failures} JavaScript file(s) failed syntax validation.`);
    process.exit(1);
}
console.log(`JavaScript syntax validation passed for ${files.length} file(s).`);
