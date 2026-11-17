import test from 'node:test';
import assert from 'node:assert/strict';
import {changeBounds, editDuration, mergedCuts} from '../web/cuts.mjs';

test('review and restore keep the full duration until a cut is applied', () => {
  const cut = {start: 2, end: 4, status: 'pending'};
  assert.equal(editDuration([cut], 8), 8);
  cut.status = 'cut';
  assert.equal(editDuration([cut], 8), 6);
  cut.status = 'keep';
  assert.equal(editDuration([cut], 8), 8);
});

test('changing a boundary requires a pending review', () => {
  const cut = {start: 2, end: 4, status: 'keep'};
  assert.equal(changeBounds(cut, 2, 5, 8).status, 'pending');
  assert.throws(() => changeBounds(cut, -1, 5, 8));
  assert.throws(() => changeBounds({...cut, status: 'cut'}, 2, 5, 8));
});

test('overlapping cuts count their shared range once', () => {
  assert.deepEqual(mergedCuts([{start: 1, end: 3, status: 'cut'}, {start: 2, end: 4, status: 'cut'}], 8), [[1, 4]]);
});
