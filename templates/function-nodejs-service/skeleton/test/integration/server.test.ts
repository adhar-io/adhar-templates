// The function as the image runs it — package.json's "start" script over the
// compiled dist/ — talked to over HTTP, then stopped the way Knative stops an
// instance it scales away. `npm test` builds dist/ first.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs';
import net, { type AddressInfo } from 'node:net';
import path from 'node:path';
import { test } from 'node:test';

const ROOT = path.join(__dirname, '..', '..');

// The node arguments of package.json's "start" script — what the image runs
// (the buildpack's start command is that script).
function startArguments(): string[] {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as { scripts?: { start?: string } };
  const [command, ...args] = (pkg.scripts?.start ?? '').trim().split(/\s+/);
  assert.equal(command, 'node', 'package.json "start" must run node');
  const entry = args.at(-1) ?? '';
  assert.ok(fs.existsSync(path.join(ROOT, entry)), `${entry} does not exist: run \`npm run build\` (npm test does)`);
  return args;
}

async function freePort(): Promise<number> {
  const probe = net.createServer().listen(0, '127.0.0.1');
  await once(probe, 'listening');
  const { port } = probe.address() as AddressInfo;
  probe.close();
  await once(probe, 'close');
  return port;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

test('the built function serves on $PORT and stops cleanly on SIGTERM', async () => {
  const port = await freePort();
  // Knative sets PORT; the Function composition sets FUNCTION_NAME and the rest.
  const child = spawn(process.execPath, startArguments(), {
    cwd: ROOT,
    env: { ...process.env, PORT: String(port), FUNCTION_TRIGGER: 'http,cron' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => {
    output += chunk;
  });
  child.stderr.on('data', (chunk: string) => {
    output += chunk;
  });
  const exited = once(child, 'exit');
  try {
    const base = `http://127.0.0.1:${port}`;
    const deadline = Date.now() + 30000;
    for (;;) {
      assert.ok(child.exitCode === null && child.signalCode === null, `the function exited while starting:\n${output}`);
      try {
        if ((await fetch(`${base}/healthz`)).ok) break;
      } catch {
        // not listening yet
      }
      assert.ok(Date.now() < deadline, `no answer on /healthz within 30 s:\n${output}`);
      await sleep(100);
    }
    const res = await fetch(`${base}/`, { method: 'POST', body: 'ping' });
    assert.equal(res.status, 200);
    const { at, ...answer } = (await res.json()) as Record<string, unknown>;
    assert.ok(typeof at === 'string' && !Number.isNaN(Date.parse(at)), `at is not a timestamp: ${String(at)}`);
    assert.deepEqual(answer, {
      ok: true,
      function: ${{ values.name | dump }},
      runtime: 'node24',
      trigger: 'http,cron',
      method: 'POST',
      path: '/',
      event: null,
      received: 4,
    });

    child.kill('SIGTERM');
    const timer = setTimeout(() => child.kill('SIGKILL'), 10000);
    const [code, signal] = (await exited) as [number | null, NodeJS.Signals | null];
    clearTimeout(timer);
    assert.equal(signal, null, `killed by ${String(signal)} instead of exiting within 10 s:\n${output}`);
    assert.equal(code, 0, `exited with ${String(code)}:\n${output}`);
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  }
});
