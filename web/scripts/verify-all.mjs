import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const webDir = resolve(scriptDir, '..');
const repoRoot = resolve(webDir, '..');
const serverDir = join(repoRoot, 'server');
const evidenceDir = join(webDir, 'evidence', 'verify-all');

/** Discover all `*-local-verify.mjs` scripts in `web/scripts/` dynamically in sorted order. */
function discoverLocalVerifySteps() {
  return readdirSync(scriptDir)
    .filter((file) => file.endsWith('-local-verify.mjs'))
    .sort()
    .map((file) => {
      const name = file.replace(/\.mjs$/, '');
      return {
        name,
        cwd: webDir,
        command: process.execPath,
        args: [join('scripts', file)],
        envOverrides: {}
      };
    });
}

/** Build `TEST_DATABASE_URL` with `/router_test` pathname for `local-browser-verify.mjs`. */
function localBrowserTestEnv() {
  const rawUrl = process.env.TEST_DATABASE_URL;
  if (!rawUrl) {
    return { env: {}, note: null };
  }
  const parsed = new URL(rawUrl);
  if (parsed.pathname === '/router_test') {
    return { env: {}, note: null };
  }
  const previousPath = parsed.pathname;
  parsed.pathname = '/router_test';
  return {
    env: { TEST_DATABASE_URL: parsed.toString() },
    note: `[verify-all] test-local: TEST_DATABASE_URL pathname disesuaikan ${previousPath} -> /router_test (host/port/kredensial tetap dari env)`
  };
}

function buildSteps() {
  const localEnv = localBrowserTestEnv();
  return [
    {
      name: 'typecheck-server',
      cwd: serverDir,
      command: 'npm',
      args: ['run', 'typecheck'],
      envOverrides: {},
      note: null
    },
    {
      name: 'typecheck-web',
      cwd: webDir,
      command: 'npm',
      args: ['run', 'typecheck'],
      envOverrides: {},
      note: null
    },
    {
      name: 'unit',
      cwd: webDir,
      command: 'npm',
      args: ['test'],
      envOverrides: {},
      note: null
    },
    {
      name: 'playwright',
      cwd: webDir,
      command: 'npm',
      args: ['run', 'test:e2e', '--', '--reporter=line'],
      envOverrides: { CI: process.env.CI || '1' },
      note: null
    },
    {
      name: 'test-local',
      cwd: webDir,
      command: process.execPath,
      args: [join('scripts', 'local-browser-verify.mjs')],
      envOverrides: localEnv.env,
      note: localEnv.note
    },
    ...discoverLocalVerifySteps(),
    {
      name: 'a11y-audit',
      cwd: webDir,
      command: process.execPath,
      args: [join('scripts', 'a11y-audit.mjs')],
      envOverrides: {},
      note: null
    }
  ];
}

function printHelp(steps) {
  const names = steps.map((step) => step.name).join(', ');
  console.log([
    'Pemakaian: node scripts/verify-all.mjs [--only <nama[,nama2]>] [--skip <nama[,nama2]>] [--list]',
    '',
    'Menjalankan seluruh verifikasi secara berurutan dengan port & database dari environment.',
    `Langkah tersedia: ${names}`
  ].join('\n'));
}

function parseListFlag(argv, index, inlineValue, flagName) {
  const raw = inlineValue !== undefined ? inlineValue : argv[index + 1];
  if (!raw || (inlineValue === undefined && raw.startsWith('--'))) {
    throw new Error(`Flag ${flagName} membutuhkan nama langkah.`);
  }
  const items = raw
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  if (items.length === 0) {
    throw new Error(`Flag ${flagName} tidak boleh kosong.`);
  }
  return { items, consumedNext: inlineValue === undefined };
}

function parseArgs(argv, knownNames) {
  const only = new Set();
  const skip = new Set();
  let listOnly = false;
  let help = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      help = true;
      continue;
    }
    if (arg === '--list') {
      listOnly = true;
      continue;
    }
    if (arg === '--only' || arg.startsWith('--only=')) {
      const inline = arg.startsWith('--only=') ? arg.slice('--only='.length) : undefined;
      const parsed = parseListFlag(argv, i, inline, '--only');
      for (const name of parsed.items) only.add(name);
      if (parsed.consumedNext) i += 1;
      continue;
    }
    if (arg === '--skip' || arg.startsWith('--skip=')) {
      const inline = arg.startsWith('--skip=') ? arg.slice('--skip='.length) : undefined;
      const parsed = parseListFlag(argv, i, inline, '--skip');
      for (const name of parsed.items) skip.add(name);
      if (parsed.consumedNext) i += 1;
      continue;
    }
    throw new Error(`Argumen tidak dikenal: ${arg}`);
  }

  for (const name of [...only, ...skip]) {
    if (!knownNames.has(name)) {
      throw new Error(`Nama langkah tidak dikenal: ${name}. Langkah tersedia: ${[...knownNames].join(', ')}`);
    }
  }

  return { only, skip, listOnly, help };
}

function formatDuration(ms) {
  return `${(ms / 1000).toFixed(2)}s`;
}

function runStep(step) {
  return new Promise((resolveStep) => {
    const startedAt = new Date();
    const startMs = performance.now();
    const env = { ...process.env, ...step.envOverrides };
    const chunks = [];
    if (step.note) chunks.push(`${step.note}\n`);

    const child = spawn(step.command, step.args, {
      cwd: step.cwd,
      env,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    child.stdout.on('data', (chunk) => chunks.push(chunk.toString('utf8')));
    child.stderr.on('data', (chunk) => chunks.push(chunk.toString('utf8')));

    child.on('error', (error) => {
      const durationMs = performance.now() - startMs;
      chunks.push(`\n[verify-all] spawn error: ${error.message}\n`);
      writeStepLog(step, startedAt, null, durationMs, chunks.join(''));
      resolveStep({ name: step.name, passed: false, exitCode: null, durationMs });
    });

    child.on('close', (code, signal) => {
      const durationMs = performance.now() - startMs;
      if (signal) chunks.push(`\n[verify-all] terminated by signal: ${signal}\n`);
      writeStepLog(step, startedAt, code, durationMs, chunks.join(''));
      resolveStep({ name: step.name, passed: code === 0, exitCode: code, durationMs });
    });
  });
}

function writeStepLog(step, startedAt, exitCode, durationMs, body) {
  const header = [
    `# langkah: ${step.name}`,
    `# cwd: ${step.cwd}`,
    `# perintah: ${step.command} ${step.args.join(' ')}`,
    `# mulai: ${startedAt.toISOString()}`,
    `# durasi: ${formatDuration(durationMs)}`,
    `# exit: ${exitCode === null ? 'null' : String(exitCode)}`,
    '---',
    ''
  ].join('\n');
  writeFileSync(join(evidenceDir, `${step.name}.txt`), `${header}${body}`, 'utf8');
}

function printSummaryTable(results) {
  const headers = {
    step: 'langkah',
    status: 'hasil',
    duration: 'durasi'
  };
  const rows = results.map((result) => ({
    step: result.name,
    status: result.passed ? 'lulus' : 'gagal',
    duration: formatDuration(result.durationMs)
  }));

  const stepWidth = Math.max(headers.step.length, ...rows.map((row) => row.step.length));
  const statusWidth = Math.max(headers.status.length, ...rows.map((row) => row.status.length));
  const durationWidth = Math.max(headers.duration.length, ...rows.map((row) => row.duration.length));

  const formatRow = (row) =>
    `${row.step.padEnd(stepWidth)} | ${row.status.padEnd(statusWidth)} | ${row.duration.padStart(durationWidth)}`;

  const divider = `${'-'.repeat(stepWidth)}-+-${'-'.repeat(statusWidth)}-+-${'-'.repeat(durationWidth)}`;
  console.log('');
  console.log(formatRow(headers));
  console.log(divider);
  for (const row of rows) {
    console.log(formatRow(row));
  }
}

async function main() {
  const allSteps = buildSteps();
  const knownNames = new Set(allSteps.map((step) => step.name));

  let options;
  try {
    options = parseArgs(process.argv.slice(2), knownNames);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    printHelp(allSteps);
    process.exitCode = 1;
    return;
  }

  if (options.help) {
    printHelp(allSteps);
    return;
  }

  if (options.listOnly) {
    for (const step of allSteps) console.log(step.name);
    return;
  }

  const selected = allSteps.filter((step) => {
    if (options.only.size > 0 && !options.only.has(step.name)) return false;
    if (options.skip.has(step.name)) return false;
    return true;
  });

  if (selected.length === 0) {
    console.error('Tidak ada langkah yang terpilih untuk dijalankan.');
    process.exitCode = 1;
    return;
  }

  mkdirSync(evidenceDir, { recursive: true });
  const results = [];
  const totalStart = performance.now();

  for (let i = 0; i < selected.length; i += 1) {
    const step = selected[i];
    console.log(`[${i + 1}/${selected.length}] RUN   ${step.name}`);
    const result = await runStep(step);
    results.push(result);
    const label = result.passed ? 'PASS ' : 'FAIL ';
    const codeText = result.exitCode === null ? '' : ` (exit ${result.exitCode})`;
    console.log(
      `[${i + 1}/${selected.length}] ${label} ${step.name} (${formatDuration(result.durationMs)})${codeText} -> web/evidence/verify-all/${step.name}.txt`
    );
  }

  printSummaryTable(results);
  const failed = results.filter((result) => !result.passed);
  const totalDuration = formatDuration(performance.now() - totalStart);
  console.log(`\nTotal: ${results.length - failed.length}/${results.length} lulus dalam ${totalDuration}`);
  if (failed.length > 0) {
    process.exitCode = 1;
  }
}

await main();
