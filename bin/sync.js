import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PACKAGE_DIR = path.join(__dirname, '..');

const EXCLUDED_FILENAMES = ['CLAUDE.md'];
const SKIP_PATHS = ['skills/active', 'cron', 'triggers'];

function destPath(templateRelPath) {
  if (templateRelPath.endsWith('.template')) {
    return templateRelPath.slice(0, -'.template'.length);
  }
  return templateRelPath;
}

function templatePath(userPath, templatesDir) {
  const withSuffix = userPath + '.template';
  if (fs.existsSync(path.join(templatesDir, withSuffix))) {
    return withSuffix;
  }
  return userPath;
}

function isSkipped(relPath) {
  return SKIP_PATHS.some(p => relPath === p || relPath.startsWith(p + '/'));
}

function mirrorTemplates(projectPath) {
  const templatesDir = path.join(PACKAGE_DIR, 'templates');
  const copiedPaths = new Set();

  // 1. Copy all template files, overwriting everything (skip skills/active)
  function walk(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const relPath = path.relative(templatesDir, fullPath);
      if (isSkipped(relPath)) continue;

      if (entry.isSymbolicLink()) {
        const outPath = destPath(relPath);
        const dest = path.join(projectPath, outPath);
        const target = fs.readlinkSync(fullPath);
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        try { fs.unlinkSync(dest); } catch {}
        fs.symlinkSync(target, dest);
        copiedPaths.add(outPath);
        console.log(`    ${outPath} -> ${target}`);
      } else if (entry.isDirectory()) {
        walk(fullPath);
      } else if (!EXCLUDED_FILENAMES.includes(entry.name)) {
        const outPath = destPath(relPath);
        const dest = path.join(projectPath, outPath);
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.copyFileSync(fullPath, dest);
        copiedPaths.add(outPath);
        console.log(`    ${outPath}`);
      }
    }
  }
  walk(templatesDir);

  // 2. Delete files in project that don't exist in templates (skip skills/active)
  function walkProject(dir) {
    if (!fs.existsSync(dir)) return;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const relPath = path.relative(projectPath, fullPath);
      if (isSkipped(relPath)) continue;

      if (entry.isSymbolicLink()) {
        const tmplPath = templatePath(relPath, templatesDir);
        if (!copiedPaths.has(relPath) && !fs.existsSync(path.join(templatesDir, tmplPath))) {
          fs.unlinkSync(fullPath);
          console.log(`    Deleted ${relPath} (stale)`);
        }
      } else if (entry.isDirectory()) {
        walkProject(fullPath);
      } else {
        const tmplPath = templatePath(relPath, templatesDir);
        if (!copiedPaths.has(relPath) && !fs.existsSync(path.join(templatesDir, tmplPath))) {
          fs.unlinkSync(fullPath);
          console.log(`    Deleted ${relPath} (stale)`);
        }
      }
    }
  }

  // Walk only directories that templates touches (don't delete user's .env, data/, etc.)
  for (const entry of fs.readdirSync(templatesDir, { withFileTypes: true })) {
    const dest = path.join(projectPath, entry.name);
    if (entry.isDirectory() && fs.existsSync(dest)) {
      walkProject(dest);
    }
  }

  // Remove empty directories left behind
  function removeEmptyDirs(dir) {
    if (!fs.existsSync(dir)) return;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) removeEmptyDirs(path.join(dir, entry.name));
    }
    if (fs.readdirSync(dir).length === 0) {
      console.log(`    Deleted ${dir} (empty)`);
      fs.rmdirSync(dir);
    }
  }
  for (const entry of fs.readdirSync(templatesDir, { withFileTypes: true })) {
    const dest = path.join(projectPath, entry.name);
    if (entry.isDirectory() && fs.existsSync(dest)) {
      removeEmptyDirs(dest);
    }
  }
}

function buildDockerImage(projectPath) {
  console.log('\n  Building Docker event handler image...');

  const dockerfilePath = path.join(projectPath, 'docker', 'event-handler', 'Dockerfile');
  let dockerfile = fs.readFileSync(dockerfilePath, 'utf8');

  // Add COPY for tarball after the package.json COPY line in builder stage
  dockerfile = dockerfile.replace(
    'COPY package.json package-lock.json* ./',
    'COPY package.json package-lock.json* ./\nCOPY .thepopebot-dev.tgz /tmp/thepopebot.tgz'
  );

  // Replace npm install from registry with local tarball install
  dockerfile = dockerfile.replace(
    /RUN npm install --omit=dev && \\\n\s+npm install --no-save thepopebot@\$\(node -p "require\('\.\/package\.json'\)\.version"\)/,
    'RUN npm install --omit=dev && \\\n    npm install --no-save /tmp/thepopebot.tgz && rm /tmp/thepopebot.tgz'
  );

  // Fix template paths for project context (templates/docker/... → docker/...)
  dockerfile = dockerfile.replace(/COPY templates\//g, 'COPY ');

  // Read version from package.json
  const pkg = JSON.parse(fs.readFileSync(path.join(PACKAGE_DIR, 'package.json'), 'utf8'));
  const version = pkg.version;
  const imageTag = `stephengpope/thepopebot:event-handler-${version}`;

  // Build using stdin Dockerfile with project dir as context (no cache to ensure fresh package)
  execSync(`docker build --no-cache -f - -t ${imageTag} .`, {
    input: dockerfile,
    stdio: ['pipe', 'inherit', 'inherit'],
    cwd: projectPath,
  });

  // Update THEPOPEBOT_VERSION in .env
  const envPath = path.join(projectPath, '.env');
  if (fs.existsSync(envPath)) {
    let env = fs.readFileSync(envPath, 'utf8');
    if (env.match(/^THEPOPEBOT_VERSION=.*/m)) {
      env = env.replace(/^THEPOPEBOT_VERSION=.*/m, `THEPOPEBOT_VERSION=${version}`);
    } else {
      env = env.trimEnd() + `\nTHEPOPEBOT_VERSION=${version}\n`;
    }
    fs.writeFileSync(envPath, env);
    console.log(`  Updated THEPOPEBOT_VERSION to ${version}`);
  }
}

export async function sync(projectPath) {
  if (!projectPath) {
    console.error('\n  Usage: thepopebot sync <path-to-project>\n');
    process.exit(1);
  }

  projectPath = path.resolve(projectPath);

  if (!fs.existsSync(path.join(projectPath, 'package.json'))) {
    console.error(`\n  Not a project directory (no package.json): ${projectPath}\n`);
    process.exit(1);
  }

  // 1. Build JSX
  console.log('\n  Building package...');
  execSync('npm run build', { stdio: 'inherit', cwd: PACKAGE_DIR });

  // 2. npm pack
  console.log('\n  Packing...');
  const packOutput = execSync('npm pack', { cwd: PACKAGE_DIR, encoding: 'utf8' }).trim();
  // npm pack may output warnings before the filename — tarball is always the last line
  const tarball = packOutput.split('\n').pop().trim();
  const tarballSrc = path.join(PACKAGE_DIR, tarball);
  const tarballDest = path.join(projectPath, '.thepopebot-dev.tgz');

  try {
    fs.copyFileSync(tarballSrc, tarballDest);
    fs.unlinkSync(tarballSrc);

    // 3. Mirror templates (hard overwrite + delete stale managed files)
    console.log('\n  Mirroring templates...');
    mirrorTemplates(projectPath);

    // 4. Install on host (--no-save so package.json keeps its registry reference)
    console.log('\n  Installing package on host...');
    execSync(`npm install --no-save ${tarballDest}`, { stdio: 'inherit', cwd: projectPath });

    // 5. Build Next.js on host (avoids OOM inside container)
    console.log('\n  Building Next.js...');
    fs.rmSync(path.join(projectPath, '.next'), { recursive: true, force: true });
    execSync('npm run build', { stdio: 'inherit', cwd: projectPath });

    // 6. Build Docker image with patched Dockerfile
    buildDockerImage(projectPath);

    // 7. Restart container (fresh start picks up .next via volume mount)
    console.log('\n  Restarting event handler...');
    execSync('docker compose up -d -V event-handler', { stdio: 'inherit', cwd: projectPath });

  } finally {
    // 7. Cleanup
    try { fs.unlinkSync(tarballDest); } catch {}
    try { fs.unlinkSync(tarballSrc); } catch {}
  }

  console.log('\n  Synced!\n');
}
