import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { closestProfiles } from '../public/similarity.mjs';

const catalog = JSON.parse(readFileSync(new URL('../data/catalog.json', import.meta.url), 'utf8'));
const dimensions = [{ id: 'first' }, { id: 'second' }];
const profile = [{ id: 'second', score: 100 }, { id: 'first', score: 0 }];
const approach = (id, first, second) => ({ id, ratings: { first: { score: first }, second: { score: second } } });

test('an exact catalog profile has zero gap and keeps the original approach object', () => {
  const reference = catalog.approaches.find(item => item.id === 'playbooks');
  const scores = catalog.dimensions.map(({ id }) => ({ id, score: reference.ratings[id].score }));
  const result = closestProfiles(catalog.dimensions, catalog.approaches, scores);
  assert.equal(result.length, 3);
  assert.equal(result[0].approach, reference);
  assert.equal(result[0].gap, 0);
});

test('ranks equal-weight mean absolute score gaps, preserving zero and matching IDs', () => {
  const references = [approach('far', 100, 0), approach('near', 0, 75), approach('middle', 50, 50)];
  const before = structuredClone({ references, profile });
  assert.deepEqual(closestProfiles(dimensions, references, profile).map(({ approach, gap }) => [approach.id, gap]), [
    ['near', 12.5], ['middle', 50], ['far', 100],
  ]);
  assert.deepEqual({ references, profile }, before);
});

test('ties retain catalog order and the limit controls the number of results', () => {
  const references = [approach('a', 0, 50), approach('b', 50, 100), approach('c', 25, 75), approach('d', 50, 100)];
  assert.deepEqual(closestProfiles(dimensions, references, profile).map(item => item.approach.id), ['a', 'b', 'c']);
  assert.equal(closestProfiles(dimensions, references, profile, 10).length, 4);
  assert.deepEqual(closestProfiles(dimensions, references, profile, 0), []);
  assert.deepEqual(closestProfiles(dimensions, [], profile), []);
});

test('rejects missing, duplicate, or unknown profile dimensions', () => {
  const references = [approach('a', 0, 100)];
  for (const invalid of [[], [{ id: 'first', score: 0 }], [{ id: 'first', score: 0 }, { id: 'first', score: 100 }], [{ id: 'first', score: 0 }, { id: 'unknown', score: 100 }]]) {
    assert.throws(() => closestProfiles(dimensions, references, invalid), /dimension/i);
  }
});

test('rejects missing, nonfinite, nonnumeric, and out-of-range scores on either side', () => {
  for (const score of [undefined, null, NaN, Infinity, -Infinity, '0', -1, 101]) {
    assert.throws(() => closestProfiles(dimensions, [approach('a', 0, 100)], [{ id: 'first', score }, profile[0]]), /Invalid score/);
    assert.throws(() => closestProfiles(dimensions, [approach('a', score, 100)], profile), /Invalid score/);
  }
  assert.throws(() => closestProfiles(dimensions, [{ id: 'missing', ratings: {} }], profile), /Invalid score/);
});

test('rejects invalid dimension definitions and limits', () => {
  const references = [approach('a', 0, 100)];
  for (const invalid of [[], null, [{ id: 'first' }, { id: 'first' }], [{}]]) {
    assert.throws(() => closestProfiles(invalid, references, profile), /dimension/i);
  }
  for (const limit of [-1, 1.5, NaN, Infinity, '3']) {
    assert.throws(() => closestProfiles(dimensions, references, profile, limit), /Limit/);
  }
});
