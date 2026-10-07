import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
test('self-hosted OpenCV bytes match the verified 4.13.0 runtime',async()=>{
  const bytes=await readFile(new URL('../dist/vendor/opencv-4.13.0.js',import.meta.url));
  assert.equal(createHash('sha256').update(bytes).digest('hex'),'63366510248adf3a7eddf3e793dd825404efb7df3749f4d6f8557c7fa4ca8aa0');
  assert.equal(bytes.length,10964323);
});
