import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';

const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const lock = JSON.parse(await readFile(new URL('../package-lock.json', import.meta.url), 'utf8'));
const packages = lock.packages as Record<string, { version?: string; license?: string; dependencies?: Record<string, string>; hasInstallScript?: boolean }>;
const rows = [];
for (const name of Object.keys({ ...manifest.dependencies, ...manifest.devDependencies })) {
  const path = `node_modules/${name}`;
  const installed = JSON.parse(await readFile(new URL(`../${path}/package.json`, import.meta.url), 'utf8'));
  const visited = new Set<string>();
  const visit = (key: string) => {
    for (const dep of Object.keys(packages[key]?.dependencies ?? {})) {
      let cursor = key;
      let found: string | undefined;
      while (cursor) {
        const candidate = `${cursor}/node_modules/${dep}`;
        if (packages[candidate]) { found = candidate; break; }
        cursor = cursor.slice(0, cursor.lastIndexOf('/node_modules/'));
      }
      found ??= packages[`node_modules/${dep}`] ? `node_modules/${dep}` : undefined;
      if (found && !visited.has(found) && found !== path) { visited.add(found); visit(found); }
    }
  };
  visit(path);
  rows.push({ name, version: installed.version, license: installed.license, repository: installed.repository,
    directDependencies: Object.keys(installed.dependencies ?? {}).length, installedTransitive: visited.size });
}
const audit = JSON.parse(execFileSync('npm', ['audit', '--json'], { encoding: 'utf8' }));
const result = { checkedAt: new Date().toISOString(), node: process.version, rows, audit,
  installedPackages: Object.keys(packages).filter(p => p && packages[p].version).length,
  installScripts: Object.entries(packages).filter(([, p]) => p.hasInstallScript).map(([path]) => path),
  licenses: Object.entries(packages).filter(([p]) => p).map(([path, p]) => ({ path, version: p.version, license: p.license })) };
await mkdir(new URL('../evidence/', import.meta.url), { recursive: true });
await writeFile(new URL('../evidence/dependencies.json', import.meta.url), JSON.stringify(result, null, 2));
process.stdout.write(JSON.stringify({ rows, audit: audit.metadata, installedPackages: result.installedPackages, installScripts: result.installScripts }, null, 2) + '\n');
