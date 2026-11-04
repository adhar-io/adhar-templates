// The process Knative runs: serve on $PORT until SIGTERM, then finish what is
// in flight and exit. `npm start` runs it compiled (dist/server.js), and so
// does the image: the buildpack starts the "start" script in package.json.
// `npm run dev` runs this file itself, restarting it on every change.
import { loadConfig } from './config';
import { createServer } from './http';
import { log } from './log';

const config = loadConfig();
const server = createServer(config);

server.listen(config.port, () => {
  log('info', 'listening', { function: config.name, port: config.port });
});

server.on('error', (err) => {
  // Most often EADDRINUSE: nothing else keeps the process alive, so it ends
  // with this exit code once the error is logged.
  log('error', 'cannot serve', { port: config.port, error: err.message });
  process.exitCode = 1;
});

// Knative sends SIGTERM before it scales an instance away: stop taking
// connections, let the requests in flight finish, then exit.
process.once('SIGTERM', () => {
  log('info', 'stopping', { signal: 'SIGTERM' });
  server.close(() => {
    process.exit(0);
  });
});
