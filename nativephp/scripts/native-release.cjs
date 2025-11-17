#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const NATIVE_DIR = path.join(__dirname, '..');
const REPO_ROOT = path.resolve(NATIVE_DIR, '..');
const ENV_PATH = path.join(NATIVE_DIR, '.env');
const ENV_EXAMPLE_PATH = path.join(NATIVE_DIR, '.env.example');

const VALID_TARGETS = ['mac', 'win', 'linux'];
const BUILD_ONLY_FLAG = '--build-only';

function exec(command, options = {}) {
  const { cwd = NATIVE_DIR } = options;
  console.log(`\n▶ ${command}`);
  try {
    execSync(command, { stdio: 'inherit', cwd, env: process.env });
  } catch (error) {
    console.error(`\n❌ Commande échouée: ${command}`);
    process.exit(1);
  }
}

function execRepo(command) {
  exec(command, { cwd: REPO_ROOT });
}

function readVersion() {
  if (!fs.existsSync(ENV_EXAMPLE_PATH)) {
    console.warn('⚠️  .env.example introuvable : version inconnue');
    return '0.0.0';
  }

  const content = fs.readFileSync(ENV_EXAMPLE_PATH, 'utf8');
  const match = content.match(/^NATIVEPHP_APP_VERSION=(.+)$/m);
  if (!match) {
    return '0.0.0';
  }
  return match[1].replace(/^['"]/, '').replace(/['"]$/, '').trim();
}

function ensureEnv() {
  if (!fs.existsSync(ENV_PATH)) {
    console.log('ℹ️  Copie du .env depuis .env.example');
    fs.copyFileSync(ENV_EXAMPLE_PATH, ENV_PATH);
  }
}

function ensureAppKey() {
  if (!fs.existsSync(ENV_PATH)) {
    return;
  }

  const content = fs.readFileSync(ENV_PATH, 'utf8');
  const match = content.match(/^APP_KEY=(.*)$/m);

  if (!match || !match[1].trim()) {
    console.log('🔑 Génération d’une nouvelle APP_KEY');
    exec('php artisan key:generate');
  }
}

function checkGitStatus() {
  try {
    const output = execSync('git status --porcelain', { cwd: REPO_ROOT, encoding: 'utf8' });
    const lines = output
      .trim()
      .split('\n')
      .filter(Boolean)
      .filter(line => !line.startsWith('??'));

    const allowed = ['nativephp/.env.example', 'nativephp/package.json'];

    const invalid = lines.filter(line => {
      const file = line.slice(3).trim();
      return !allowed.includes(file);
    });

    if (invalid.length > 0) {
      console.error('❌ Des fichiers suivis ont été modifiés :');
      invalid.forEach(line => console.error(`  - ${line}`));
      console.error('\nVeuillez committer ou stasher ces changements avant de lancer la release.');
      process.exit(1);
    }

    return lines.length > 0;
  } catch (error) {
    console.warn('⚠️  Impossible de vérifier le statut Git. Poursuite du processus.');
    return false;
  }
}

function resolveTargets(argv) {
  const cliTargets = argv
    .filter(arg => arg !== BUILD_ONLY_FLAG)
    .filter(arg => !arg.startsWith('--'))
    .map(arg => arg.toLowerCase())
    .filter(arg => arg === 'all' || VALID_TARGETS.includes(arg));

  if (cliTargets.includes('all')) {
    return VALID_TARGETS;
  }

  if (cliTargets.length > 0) {
    return cliTargets;
  }

  const envTargets = process.env.NATIVE_TARGETS
    ? process.env.NATIVE_TARGETS.split(',').map(t => t.trim().toLowerCase()).filter(Boolean)
    : [];

  if (envTargets.length > 0) {
    return envTargets.map(target => {
      if (!VALID_TARGETS.includes(target)) {
        console.warn(`⚠️  Cible "${target}" ignorée (valeurs possibles: ${VALID_TARGETS.join(', ')})`);
        return null;
      }
      return target;
    }).filter(Boolean);
  }

  switch (process.platform) {
    case 'darwin':
      return ['mac'];
    case 'win32':
      return ['win'];
    default:
      return ['linux'];
  }
}

function main() {
  console.log('🚀 NativePHP Release\n');
  ensureEnv();
  ensureAppKey();

  const version = readVersion();
  console.log(`📦 Version détectée: ${version}\n`);

  const args = process.argv.slice(2);
  const buildOnly = args.includes(BUILD_ONLY_FLAG) || process.env.NATIVE_BUILD_ONLY === '1';
  const skipGitTag = args.includes('--skip-tag') || process.env.SKIP_GIT_TAG === '1';

  const targets = resolveTargets(args);
  if (targets.length === 0) {
    console.error('❌ Aucune cible valide fournie.');
    process.exit(1);
  }

  console.log(`🎯 Plateformes: ${targets.join(', ')}`);
  if (buildOnly) {
    console.log('🛠️  Mode build-only (pas de publication, pas de commit/tag).\n');
  }

  const hasChanges = buildOnly ? false : checkGitStatus();

  for (const target of targets) {
    console.log(`\n🔨 Build NativePHP (${target})`);
    exec(`php artisan native:build ${target}`);

    if (!buildOnly) {
      console.log(`\n🚢 Publication NativePHP (${target})`);
      exec(`php artisan native:publish ${target}`);
    }
  }

  if (!buildOnly && hasChanges) {
    console.log('\n📝 Commit version');
    execRepo('git add nativephp/.env.example nativephp/package.json');
    execRepo(`git commit -m "chore: release native version ${version}"`);
  }

  if (!buildOnly && !skipGitTag) {
    console.log('\n🏷️  Création du tag');
    try {
      execRepo(`git tag -a v${version} -m "Native release ${version}"`);
    } catch (error) {
      console.warn('⚠️  Impossible de créer le tag (existe déjà ?). Suite du processus.');
    }
  } else if (skipGitTag && !buildOnly) {
    console.log('\n🏷️  Création du tag ignorée (flag --skip-tag actif).');
  }

  console.log('\n✅ Processus terminé !');
  if (buildOnly) {
    console.log('Les binaires sont disponibles dans nativephp/dist/ (non publiés).');
  } else {
    console.log('Disponible dans nativephp/dist/ et sur la release GitHub (si publish configuré).');
    console.log('Étapes suivantes : push + push --tags si nécessaire.');
  }
  console.log('');
}

main();
