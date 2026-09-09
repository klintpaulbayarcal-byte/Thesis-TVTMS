const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..', '..');
const source = path.join(projectRoot, 'frontend');
const destination = path.join(projectRoot, 'dist');

fs.rmSync(destination, { recursive: true, force: true });
fs.cpSync(source, destination, { recursive: true });

console.log(`Production frontend copied to ${path.relative(projectRoot, destination)}/`);