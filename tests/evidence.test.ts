import test from 'node:test';
import assert from 'node:assert/strict';
import { createEvidence } from '../src/core/evidence.ts';

test('evidence hash is stable for equivalent structured payloads', () => {
  const a = createEvidence({
    claimId: 'c1', stepId: 's1', adapter: 'github', source: 'repo',
    revision: 'abc', extractedFacts: { z: 1, a: 2 }, raw: { nested: { b: 2, a: 1 } }, result: 'PASS'
  }, new Date('2026-08-15T00:00:00Z'));
  const b = createEvidence({
    claimId: 'c1', stepId: 's1', adapter: 'github', source: 'repo',
    revision: 'abc', extractedFacts: { a: 2, z: 1 }, raw: { nested: { a: 1, b: 2 } }, result: 'PASS'
  }, new Date('2026-08-15T00:00:00Z'));
  assert.equal(a.rawHash, b.rawHash);
});
