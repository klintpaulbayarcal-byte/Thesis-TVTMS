const fs = require('node:fs');
const path = require('node:path');
const { ZipFile } = require('yazl');

const projectRoot = path.resolve(__dirname, '..');
const destination = path.join(projectRoot, 'dist');
const archivePath = path.join(projectRoot, 'hostinger-app.zip');
const frontendSource = path.join(projectRoot, 'frontend');
const backendSource = path.join(projectRoot, 'backend');
const frontendDestination = path.join(destination, 'frontend');
const backendDestination = path.join(destination, 'backend');
const runtimeBackendEntries = ['config', 'controllers', 'middleware', 'routes', 'utils', 'server.js'];

const copyFrontend = () => {
  fs.cpSync(frontendSource, frontendDestination, { recursive: true });
};

const copyBackend = () => {
  fs.mkdirSync(backendDestination, { recursive: true });
  for (const entry of runtimeBackendEntries) {
    fs.cpSync(path.join(backendSource, entry), path.join(backendDestination, entry), { recursive: true });
  }
};

const writeRuntimePackage = () => {
  const sourcePackage = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));
  const runtimePackage = {
    name: sourcePackage.name,
    version: sourcePackage.version,
    private: true,
    main: 'backend/server.js',
    scripts: { start: 'node backend/server.js' },
    engines: sourcePackage.engines,
    dependencies: sourcePackage.dependencies
  };
  fs.writeFileSync(path.join(destination, 'package.json'), `${JSON.stringify(runtimePackage, null, 2)}\n`);
  fs.copyFileSync(path.join(backendSource, '.env.production.example'), path.join(destination, '.env.example'));
};

const createArchive = () => new Promise((resolve, reject) => {
  const zip = new ZipFile();
  const output = fs.createWriteStream(archivePath);
  output.on('close', resolve);
  output.on('error', reject);
  zip.outputStream.on('error', reject);
  zip.outputStream.pipe(output);

  const addDirectory = (directory, archiveDirectory = '') => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const sourcePath = path.join(directory, entry.name);
      const archivePathname = path.posix.join(archiveDirectory, entry.name);
      if (entry.isDirectory()) addDirectory(sourcePath, archivePathname);
      else if (entry.isFile()) zip.addFile(sourcePath, archivePathname);
    }
  };
  addDirectory(destination);
  zip.end();
});

(async () => {
  fs.rmSync(destination, { recursive: true, force: true });
  fs.rmSync(archivePath, { force: true });
  fs.mkdirSync(destination, { recursive: true });
  copyFrontend();
  copyBackend();
  writeRuntimePackage();

  const requiredFiles = [
    'package.json',
    'backend/server.js',
    'backend/config/supabase.js',
    'frontend/index.html',
    'frontend/pages/landing.html',
    'frontend/assets/js/api.js'
  ];
  for (const relativePath of requiredFiles) {
    if (!fs.existsSync(path.join(destination, relativePath))) {
      throw new Error(`Hostinger build is missing ${relativePath}`);
    }
  }

  await createArchive();
  const archiveSizeMb = (fs.statSync(archivePath).size / 1024 / 1024).toFixed(2);
  console.log(`Hostinger Node.js application built in dist/`);
  console.log(`Upload hostinger-app.zip (${archiveSizeMb} MB) through hPanel Deploy Web App.`);
})().catch(error => {
  console.error(`Build failed: ${error.message}`);
  process.exit(1);
});
