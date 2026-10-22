import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const requirePackage = createRequire(path.join(root, 'package.json'));
const ts = requirePackage('typescript');
const cache = new Map();
const allowed = [
  'src/server/services/stock/', 'src/server/repositories/in-memory/',
  'src/server/repositories/interfaces/', 'src/server/locking/',
  'src/server/idempotency/', 'src/server/recovery/', 'src/server/audit/',
  'src/lib/', 'src/types/', 'src/server/api-response.ts',
];
const denied = () => { throw new Error('Benchmark safety guard: external I/O is forbidden'); };
const sheetsGuard = {
  SHEETS: Object.freeze({ DOCUMENTS: 'DOCUMENTS', STOCK_MOVEMENTS: 'STOCK_MOVEMENTS' }),
  appendRows: denied, readSheet: denied, updateRow: denied, deleteRows: denied,
  getWarehouseSheetName: denied,
};

/** Load real TS services without Jest, TS path aliases, or the production repository. */
export function loadBenchmarkSource(relative) {
  return load(path.resolve(root, relative));
}

function load(candidate) {
  const filename = [candidate, `${candidate}.ts`, path.join(candidate, 'index.ts')]
    .find((name) => fs.existsSync(name) && fs.statSync(name).isFile());
  if (!filename) throw new Error(`Cannot resolve benchmark source: ${candidate}`);
  const relative = path.relative(root, filename).replaceAll('\\', '/');
  if (!allowed.some((entry) => entry.endsWith('/') ? relative.startsWith(entry) : entry === relative)) {
    throw new Error(`Benchmark source is outside the whitelist: ${relative}`);
  }
  if (cache.has(filename)) return cache.get(filename).exports;
  const loadedModule = { exports: {} };
  cache.set(filename, loadedModule);
  const source = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: filename,
  }).outputText;
  const localRequire = (request) => {
    // This import exists in transfer-stock for admin approval. Employee submit
    // must never reach it; fail loudly instead of silently simulating Sheets.
    if (request === '@/server/google-sheets/client') return sheetsGuard;
    // This harness measures in-memory repositories and the local lock branch.
    // Never inherit the app's storage setting or load a database connection.
    if (request === '@/server/repositories/storage-driver') return { getStorageDriver: () => 'sheets' };
    if (request === '@/server/storage-transaction') return { withStorageTransaction: denied };
    if (request.startsWith('@/')) return load(path.resolve(root, 'src', request.slice(2)));
    if (request.startsWith('.')) return load(path.resolve(path.dirname(filename), request));
    if (['zod', 'next/server', 'async_hooks', 'crypto'].includes(request)) return requirePackage(request);
    throw new Error(`Benchmark blocked package import: ${request}`);
  };
  vm.runInThisContext(`(function(require,module,exports,__filename,__dirname){${source}\n})`, { filename })(
    localRequire, loadedModule, loadedModule.exports, filename, path.dirname(filename),
  );
  return loadedModule.exports;
}

export { root };
