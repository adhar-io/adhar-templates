// Serves the PRODUCTION build for the end-to-end tests, the way the image does:
// static files from the Angular build's browser output, and index.html for any
// path that is not a file (nginx with push-state, see project.toml). Plain Node,
// no dependencies. Run from the repository root: `node e2e/serve.mjs`.
import { createReadStream, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, resolve, sep } from 'node:path';

const host = process.env.HOST ?? '127.0.0.1';
const port = Number(process.env.PORT ?? 4300);

// The output folder comes from angular.json, so renaming the project or moving
// the build output does not break the tests.
const angular = JSON.parse(readFileSync('angular.json', 'utf8'));
const [project] = Object.values(angular.projects);
const outputPath = project.architect.build.options.outputPath;
const root =
  typeof outputPath === 'string'
    ? resolve(outputPath, 'browser')
    : resolve(outputPath.base, outputPath.browser ?? 'browser');
const index = join(root, 'index.html');
statSync(index); // fail fast, with the path in the error, when there is no build

const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

function fileFor(url) {
  const path = decodeURIComponent(new URL(url, 'http://localhost').pathname);
  const file = resolve(join(root, path));
  if (file !== root && !file.startsWith(root + sep)) return index;
  try {
    return statSync(file).isFile() ? file : index;
  } catch {
    return index;
  }
}

createServer((req, res) => {
  const file = fileFor(req.url ?? '/');
  res.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream' });
  createReadStream(file).pipe(res);
}).listen(port, host, () => {
  console.log(`Serving ${root} on http://${host}:${port}`);
});
