import test from 'node:test';
import assert from 'node:assert/strict';
import {applyPlan, removeSource, segments, sourceRanges, validBounds} from '../web/project.mjs';

function projectWithSources() {
  const sources = [{id: 'a', sha256: 'hash-a', duration: 10}, {id: 'b', sha256: 'hash-b', duration: 8}];
  return {sources, order: ['a', 'b'], cuts: [], duplicates: [], reasons: {a: 'First', b: 'Second'}};
}

test('pending, confirmed and restored intervals update the timeline', () => {
  const project = projectWithSources();
  const interval = {source: 'a', start: 3, end: 5, status: 'pending'};
  project.cuts = [interval];
  const ranges = draft => segments(project, draft).map(({source, start, end}) => [source, start, end]);
  const full = [['a', 0, 10], ['b', 0, 8]];
  const cut = [['a', 0, 3], ['a', 5, 10], ['b', 0, 8]];
  assert.deepEqual(ranges(true), full);
  interval.status = 'draft';
  assert.deepEqual(ranges(true), cut);
  assert.deepEqual(ranges(false), full);
  interval.status = 'cut';
  assert.deepEqual(ranges(false), cut);
  interval.status = 'keep';
  assert.deepEqual(ranges(false), full);
});

test('new AI proposals respect explicit decisions on overlapping intervals', () => {
  const project = projectWithSources();
  const kept = {source: 'a', start: 2, end: 4, status: 'keep', origin: 'ai'};
  project.cuts = [kept];
  applyPlan(project, {cuts: [{source: 'a', start: 3, end: 5}, {source: 'b', start: 1, end: 2}],
    duplicates: [], order: [{source: 'a'}, {source: 'b'}]}, () => 'new-cut');
  assert.deepEqual(project.cuts, [kept, {source: 'b', start: 1, end: 2, id: 'new-cut', origin: 'ai', status: 'draft'}]);
});

test('cut boundaries must be finite and inside the source', () => {
  assert.equal(validBounds(2, 3, 10), true);
  for (const [start, end] of [[-1, 3], [2, 2.05], [9, 11], [0, Infinity], [NaN, 4]]) {
    assert.equal(validBounds(start, end, 10), false);
  }
});

test('overlapping cuts remove their shared interval once', () => {
  assert.deepEqual(sourceRanges(10, [{start: 4, end: 8}, {start: 2, end: 5}]), [[0, 2], [8, 10]]);
});

test('removing a source reopens comparisons and preserves unrelated edits', () => {
  const project = projectWithSources();
  const unrelated = {source: 'a', start: 6, end: 8, status: 'cut'};
  project.cuts = [{source: 'a', start: 1, end: 2, status: 'cut', comparison: {source: 'b'}}, unrelated];
  removeSource(project, 'b');
  assert.deepEqual(project.order, ['a']);
  assert.equal(project.cuts[0].comparison, null);
  assert.equal(project.cuts[0].status, 'pending');
  assert.equal(project.cuts[1], unrelated);
});
