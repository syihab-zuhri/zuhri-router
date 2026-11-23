#!/usr/bin/env node
// Minimal zero-dependency TCP <-> Unix socket bridge for chromium-netns.sh.
// Modes:
//   host <sockDir> <commaPorts> <parentPid> <readyFile>
//     Listens on <sockDir>/p<port>.sock in host netns and forwards to 127.0.0.1:<port>.
//   ns <sockDir> <commaPorts> <parentPid> <readyFile>
//     Listens on 127.0.0.1:<port> inside isolated netns and forwards to <sockDir>/p<port>.sock.
import { rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { join } from 'node:path';

const [mode, sockDir, rawPorts, rawParentPid, readyFile] = process.argv.slice(2);
if ((mode !== 'host' && mode !== 'ns') || !sockDir || !rawPorts || !rawParentPid || !readyFile) {
  process.stderr.write('Usage: chromium-netns-bridge.mjs <host|ns> <sockDir> <ports> <parentPid> <readyFile>\n');
  process.exit(2);
}

const parentPid = Number(rawParentPid);
const ports = [...new Set(
  rawPorts
    .split(',')
    .map(p => Number(p.trim()))
    .filter(p => Number.isInteger(p) && p >= 1 && p <= 65535),
)];

const servers = [];
const sockets = new Set();
let closing = false;

function track(sock) {
  sockets.add(sock);
  sock.on('close', () => sockets.delete(sock));
}

function wire(a, b) {
  track(a);
  track(b);
  a.on('error', () => b.destroy());
  b.on('error', () => a.destroy());
  a.on('close', () => b.destroy());
  b.on('close', () => a.destroy());
  a.pipe(b);
  b.pipe(a);
}

function shutdown(code = 0) {
  if (closing) return;
  closing = true;
  clearInterval(watchdog);
  for (const s of sockets) s.destroy();
  for (const srv of servers) {
    try { srv.close(); } catch {}
  }
  if (mode === 'host') {
    try { rmSync(sockDir, { recursive: true, force: true }); } catch {}
  }
  process.exit(code);
}

process.on('SIGTERM', () => shutdown(0));
process.on('SIGINT', () => shutdown(0));
process.on('SIGHUP', () => shutdown(0));

const watchdog = setInterval(() => {
  if (Number.isInteger(parentPid) && parentPid > 1) {
    try {
      process.kill(parentPid, 0);
    } catch {
      shutdown(0);
    }
  }
}, 400);
watchdog.unref();

async function listenAll() {
  for (const port of ports) {
    const sockPath = join(sockDir, `p${port}.sock`);
    const srv = net.createServer(client => {
      if (mode === 'host') {
        const upstream = net.connect({ host: '127.0.0.1', port });
        upstream.setNoDelay(true);
        wire(client, upstream);
      } else {
        client.setNoDelay(true);
        const upstream = net.connect({ path: sockPath });
        wire(client, upstream);
      }
    });
    srv.on('error', err => {
      if (!closing) {
        process.stderr.write(`[chromium-netns-bridge:${mode}] port ${port} error: ${err.message}\n`);
      }
    });
    await new Promise((resolve, reject) => {
      srv.once('error', reject);
      if (mode === 'host') {
        srv.listen(sockPath, () => {
          srv.off('error', reject);
          resolve();
        });
      } else {
        srv.listen(port, '127.0.0.1', () => {
          srv.off('error', reject);
          resolve();
        });
      }
    });
    servers.push(srv);
  }
  writeFileSync(readyFile, 'ready\n', 'utf8');
}

listenAll().catch(err => {
  process.stderr.write(`[chromium-netns-bridge:${mode}] failed: ${err instanceof Error ? err.message : String(err)}\n`);
  shutdown(1);
});
