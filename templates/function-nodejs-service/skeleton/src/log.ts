// One JSON object per line — on stdout, errors on stderr — which the platform
// collects into Loki from the container's output.

export type LogLevel = 'info' | 'warn' | 'error';
export type LogFields = Readonly<Record<string, unknown>>;
export type Log = (level: LogLevel, msg: string, fields?: LogFields) => void;

export const log: Log = (level, msg, fields = {}) => {
  const line = JSON.stringify({ time: new Date().toISOString(), level, msg, ...fields });
  (level === 'error' ? process.stderr : process.stdout).write(`${line}\n`);
};
