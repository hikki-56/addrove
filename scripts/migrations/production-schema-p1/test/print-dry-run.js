// Prints the dry-run log the migration would produce on a copy of the live sheet (synthetic sample fixture with the same shape as the live sheet).
// Repo destination: scripts/migrations/production-schema-p1/test/print-dry-run.js
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const src = fs.readFileSync(path.join(__dirname, 'run-mock-tests.js'), 'utf8')
  .split("let pass = 0;")[0]; // reuse the mock definitions only
const ctx = { require, console, __dirname, process };
vm.createContext(ctx);
vm.runInContext(src + `
const ss = makeSpreadsheet('1COPYcopyCOPYcopyCOPYcopyCOPYcopyCOPYcopy00', liveLikeTabs());
const env = makeEnv(ss, process.env.RENUMBER ? { MIGRATION_OPTIONS: JSON.stringify({ renumberDuplicateJobNo: true }) } : {});
env.ctx.dryRun();
console.log(env.logs.join('\\n'));`, ctx);
