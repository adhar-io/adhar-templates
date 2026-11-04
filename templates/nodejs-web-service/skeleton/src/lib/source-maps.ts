import { setSourceMapsSupport } from 'node:module';

// Stack traces name the TypeScript file and line — src/db/index.ts:42, not
// dist/db/index.js:38 — read from the maps the build writes beside dist/*.js.
// For this service's own code only: the packages in node_modules ship maps
// too, and loading theirs (what `node --enable-source-maps` does) cost each
// pod about 10 MB of its 128 MiB limit for frames nobody reads.
//
// src/server.ts imports this first, so every module of the service loads
// after it and is mapped.
setSourceMapsSupport(true, { nodeModules: false, generatedCode: false });
