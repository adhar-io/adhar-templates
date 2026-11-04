// The service as the image runs it — package.json's "start" script over the
// compiled dist/, with the OpenTelemetry preload deploy/base/rollout.yaml puts
// in NODE_OPTIONS, here exporting nothing — talked to over HTTP. `npm test`
// builds dist/ first and runs these with the unit tests on the Node.js
// version project.toml pins, and app-ci runs `npm test` on every push. Before
// the template had tests, app-ci's test stage found no test script and
// passed, so a change that broke every endpoint still shipped.
import assert from 'node:assert/strict';
import { type ChildProcessByStdio, spawn } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs';
import net, { type AddressInfo, type Socket } from 'node:net';
import path from 'node:path';
import type { Readable } from 'node:stream';
import { after, before, test } from 'node:test';

import type { LogLine } from '../support/logger';

const ROOT = path.join(__dirname, '..', '..');

// NODE_OPTIONS exactly as deploy/base/rollout.yaml sets it, read from there:
// a preload path that no longer matches the build fails here, not as pods
// that cannot find a module.
function rolloutNodeOptions(): string {
  const rollout = fs.readFileSync(path.join(ROOT, 'deploy', 'base', 'rollout.yaml'), 'utf8');
  const match = /- name: NODE_OPTIONS\s*\n\s*value:\s*"([^"]*)"/.exec(rollout);
  assert.ok(match?.[1], 'deploy/base/rollout.yaml sets no NODE_OPTIONS');
  return match[1];
}

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

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// The promise's value, or null once ms have passed without it.
function within<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  let timer: NodeJS.Timeout | undefined;
  const late = new Promise<null>((resolve) => {
    timer = setTimeout(resolve, ms, null);
  });
  return Promise.race([promise, late]).finally(() => clearTimeout(timer));
}

type Child = ChildProcessByStdio<null, Readable, Readable>;

// Every server started here is killed when this file's process exits, and
// none of them keeps that process alive: a test that fails half-way has to
// fail, not leave a server running that holds the CI step open until its
// timeout.
const started = new Set<Child>();
process.on('exit', () => {
  for (const child of started) child.kill('SIGKILL');
});

async function freePort(): Promise<number> {
  const probe = net.createServer().listen(0, '127.0.0.1');
  await once(probe, 'listening');
  const { port } = probe.address() as AddressInfo;
  probe.close();
  await once(probe, 'close');
  return port;
}

interface Running {
  readonly child: Child;
  readonly url: string;
  readonly exited: Promise<unknown[]>;
  // What the process printed, for a failure message.
  readonly output: () => string;
  // Its log so far, a parsed line at a time.
  readonly logs: () => LogLine[];
}

// Starts the service and resolves once /healthz answers.
async function start(): Promise<Running> {
  const port = await freePort();
  const child = spawn(process.execPath, startArguments(), {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(port),
      NODE_OPTIONS: rolloutNodeOptions(),
      OTEL_SERVICE_NAME: '${{ values.name }}',
      OTEL_TRACES_EXPORTER: 'none',
      OTEL_METRICS_EXPORTER: 'none',
      OTEL_LOGS_EXPORTER: 'none',
      OTEL_NODE_RESOURCE_DETECTORS: 'env',
{%- if values.withDatabase %}
      // Nothing listens on port 1: /db has to answer with its error.
      DATABASE_URL: 'postgresql://127.0.0.1:1/app',
{%- endif %}
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  started.add(child);
  child.unref();
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => {
    stdout += chunk;
  });
  child.stderr.on('data', (chunk: string) => {
    stderr += chunk;
  });
  // The pipes are sockets, handles of their own: unref them too, or they keep
  // this process alive after a failure.
  (child.stdout as Socket).unref();
  (child.stderr as Socket).unref();
  const exited = once(child, 'exit');
  const url = `http://127.0.0.1:${port}`;
  const output = () => `--- stdout\n${stdout}--- stderr\n${stderr}`;
  // A CI node can be busy: the preload alone takes a few seconds there.
  const deadline = Date.now() + 60000;
  for (;;) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(`the service exited while starting:\n${output()}`);
    }
    try {
      if ((await fetch(`${url}/healthz`)).ok) break;
    } catch {
      // not listening yet
    }
    if (Date.now() > deadline) {
      child.kill('SIGKILL');
      throw new Error(`the service did not answer /healthz within 60 s:\n${output()}`);
    }
    await sleep(200);
  }
  // Every complete line on stdout, parsed: the logs are JSON or this throws.
  const logs = () =>
    stdout
      .split('\n')
      .filter((line) => line.trim() !== '')
      .map((line) => {
        try {
          return JSON.parse(line) as LogLine;
        } catch {
          throw new Error(`not a JSON log line: ${line}\n${output()}`);
        }
      });
  return { child, url, exited, output, logs };
}

let server: Running | undefined;

// The server every test talks to, started once by before().
function running(): Running {
  assert.ok(server, 'the service did not start');
  return server;
}

before(async () => {
  server = await start();
});

after(() => {
  if (server && server.child.exitCode === null && server.child.signalCode === null) server.child.kill('SIGKILL');
});

test('GET / names the service', async () => {
  const res = await fetch(`${running().url}/`);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { service: '${{ values.name }}', status: 'ok' });
});

test('GET /healthz, the path both probes call, answers ok', async () => {
  const res = await fetch(`${running().url}/healthz`);
  assert.equal(res.status, 200);
  assert.equal(await res.text(), 'ok');
});
{%- if values.withDatabase %}

test('GET /db answers a JSON 500 when the database is unreachable, and the server keeps serving', async () => {
  const res = await fetch(`${running().url}/db`);
  assert.equal(res.status, 500);
  assert.equal(((await res.json()) as { db?: unknown }).db, 'error');
  assert.equal((await fetch(`${running().url}/healthz`)).status, 200);
});
{%- endif %}

// The preload, the trace propagation and the logger, end to end: a request
// that arrives inside a trace is logged with that trace's id, which is the
// link Grafana follows from a log line in Loki to the trace in Tempo.
test('a request is logged as JSON with the trace it belongs to', async () => {
  const { url, logs, output } = running();
  const traceId = '4bf92f3577b34da6a3ce929d0e0e4736';
  const res = await fetch(`${url}/?token=not-logged`, {
    headers: { traceparent: `00-${traceId}-00f067aa0ba902b7-01` },
  });
  assert.equal(res.status, 200);
  await res.arrayBuffer();
  let line: LogLine | undefined;
  for (let i = 0; i < 50 && !line; i++) {
    line = logs().find((entry) => entry.msg === 'request' && entry.trace_id === traceId);
    if (!line) await sleep(100);
  }
  assert.ok(line, `no request log line carries trace ${traceId}:\n${output()}`);
  assert.equal(line.service, '${{ values.name }}');
  assert.equal(line.path, '/');
  assert.equal(line.status, 200);
  assert.ok(!JSON.stringify(logs()).includes('not-logged'), 'the query string reached the log');
});

// A setting that is set but invalid stops the process at startup with a
// message naming it, and the stack trace names the TypeScript source
// (src/lib/source-maps.ts), not the compiled file in dist/.
test('an invalid setting stops startup, naming the variable and its .ts source', async () => {
  const child = spawn(process.execPath, startArguments(), {
    cwd: ROOT,
    env: { ...process.env, PORT: 'not-a-port' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  started.add(child);
  let stderr = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk: string) => {
    stderr += chunk;
  });
  const stopped = await within(once(child, 'exit'), 30000);
  assert.ok(stopped, 'still running 30 s after an invalid PORT');
  assert.equal(stopped[0], 1, `exited with ${String(stopped[0])}:\n${stderr}`);
  assert.match(stderr, /PORT must be a whole number from 0 to 65535, not "not-a-port"/);
  assert.match(stderr, /src[\\/]config[\\/]index\.ts:\d+/, `the stack trace does not name the .ts source:\n${stderr}`);
});

// Last: it stops the server. The kubelet sends SIGTERM and kills the pod 30 s
// later; the process has to be gone well before that, and cleanly.
test('SIGTERM stops the server cleanly within 10 s', async () => {
  const { child, exited, logs, output } = running();
  child.kill('SIGTERM');
  const stopped = await within(exited, 10000);
  assert.ok(stopped, `still running 10 s after SIGTERM:\n${output()}`);
  const [code, signal] = stopped;
  assert.equal(signal, null, `killed by ${String(signal)} instead of exiting:\n${output()}`);
  assert.equal(code, 0, `exited with ${String(code)}:\n${output()}`);
  const said = logs().map((entry) => entry.msg);
  assert.ok(said.includes('stopping') && said.includes('stopped'), `no clean stop in the log:\n${output()}`);
});
