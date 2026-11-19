import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// Contract test: the renderer must emit a safe failure artifact before its
// first external render command. No source project names or paths in receipts.
test('initial render failure has sanitized verification receipt', () => {
  const source=fs.readFileSync('scripts/render-work.mjs','utf8');
  const start=source.indexOf('function writeFailureReceipt(stage){');
  const end=source.indexOf('\ntry {\n run(\'node\'',start);
  assert.ok(start>=0 && end>start,'failure receipt must precede renderer invocation');
  const snippet=source.slice(start,end);
  const writes=[];
  const context={fs:{writeFileSync:(name,content)=>writes.push({name,content})},JSON,report:{formats:[]}};
  vm.runInNewContext(snippet+'\nwriteFailureReceipt("initial-render");',context);
  assert.equal(writes.length,1);
  assert.equal(writes[0].name,'render-verification.json');
  assert.deepEqual(JSON.parse(writes[0].content),{status:'failed',stage:'initial-render',formats:[]});
  assert.ok(source.includes("catch (error) {\n writeFailureReceipt('initial-render');"));
});
