import { isLogLevel, LOG_LEVELS, type LogLevel } from '../lib/logger';

// Every setting the service reads, read once at startup and frozen. In the
// cluster they arrive as environment variables from deploy/base/rollout.yaml;
// the defaults are what a local `npm start` uses. A setting that is present
// but invalid stops the service at startup with a message naming it, rather
// than surfacing later as a failure that points somewhere else.

export interface Config {
  readonly serviceName: string;
  // The Rollout sets PORT to the containerPort its probes call.
  readonly port: number;
  readonly logLevel: LogLevel;
  // How long a stop may wait for the requests still running. It has to end
  // inside the pod's terminationGracePeriodSeconds (30 s) less the preStop
  // sleep (5 s), or the kubelet kills the process first.
  readonly shutdownTimeoutMs: number;
{%- if values.withDatabase %}
  // From the Secret CloudNativePG generates (<name>-db-app, key uri). When it
  // is unset, node-postgres falls back to the standard PG* variables.
  readonly databaseUrl: string | undefined;
{%- endif %}
}

// process.env, or the variables a test passes instead.
export type Environment = Readonly<Record<string, string | undefined>>;

function wholeNumber(env: Environment, name: string, fallback: number, min: number, max: number): number {
  const raw = env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be a whole number from ${min} to ${max}, not "${raw}"`);
  }
  return value;
}

export function loadConfig(env: Environment = process.env): Config {
  const logLevel = (env.LOG_LEVEL || 'info').trim().toLowerCase();
  if (!isLogLevel(logLevel)) {
    throw new Error(`LOG_LEVEL must be one of ${LOG_LEVELS.join(', ')}, not "${env.LOG_LEVEL}"`);
  }
  return Object.freeze({
    serviceName: '${{ values.name }}',
    port: wholeNumber(env, 'PORT', ${{ values.port }}, 0, 65535),
    logLevel,
    shutdownTimeoutMs: wholeNumber(env, 'SHUTDOWN_TIMEOUT_MS', 20000, 0, 600000),
{%- if values.withDatabase %}
    databaseUrl: env.DATABASE_URL || undefined,
{%- endif %}
  });
}
