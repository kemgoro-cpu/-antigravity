'use strict';
const assert = require('node:assert/strict');
const Events = require('../event-utils.js');
const detect = Events.detect;
const bounds = result => result.intervals.map(event => [event.t0, event.t1, event.confirmedAt]);

assert.deepEqual(Events.normalizeOptions(), { minDuration: 0, holdoff: 0, mergeGap: 0, maxSampleGap: 0, maxResults: 300, maxSegments: 3000 });
for (const key of ['minDuration', 'holdoff', 'mergeGap', 'maxSampleGap']) {
    for (const value of [-1, NaN, Infinity, '0', null]) assert.throws(() => Events.normalizeOptions({ [key]: value }), RangeError);
}
for (const maxResults of [0, 1.5, Infinity, '3']) assert.throws(() => Events.normalizeOptions({ maxResults }), RangeError);
for (const maxSegments of [0, 1.5, Infinity, '3']) assert.throws(() => Events.normalizeOptions({ maxSegments }), RangeError);
assert.match(detect([0, 1], [0, 1], null, { minDuration: -1 }).reason, /最低継続時間/);
assert.match(detect([0, 1], [0]).reason, /点数/);
assert.match(detect([0, 1], [0, 1], [0]).reason, /点数/);
assert.match(detect([0, 1, 1], [0, 1, 1]).reason, /重複/);
assert.match(detect([0, 2, 1], [0, 1, 1]).reason, /逆転/);
assert.match(detect([0, NaN], [0, 1]).reason, /時刻/);
assert.match(detect([0, Infinity], [0, 1]).reason, /時刻/);
assert.match(detect('01', [0, 1]).reason, /配列/);
assert.equal(detect([], []).reason, '');

// Legacy zero-duration behavior keeps single samples and exact observed endpoints.
let result = detect([0, 1, 2, 3, 4, 5], [0, 1, 0, 1, 1, 0]);
assert.deepEqual(bounds(result), [[1, 1, 1], [3, 4, 3]]);
assert.equal(result.intervals[0].releaseAt, 2);
assert.equal(result.intervals[0].endReason, 'release');
assert.equal(result.intervals[0].openStart, false);
assert.equal(result.intervals[0].openEnd, false);

// Count elapsed seconds, not samples; do not invent a threshold crossing time.
result = detect([0, .1, .11, .12, .4, .7, .8], [0, 1, 1, 1, 1, 1, 0], null, { minDuration: .5 });
assert.deepEqual(bounds(result), [[.1, .7, .7]]);
assert.deepEqual(bounds(detect([0, .1, .2, .3, .4], [0, 1, 1, 1, 0], null, { minDuration: .2 })), [[.1, .3, .3]]);
assert.deepEqual(bounds(detect([0, 1, 2], [0, 1, 0], null, { minDuration: .1 })), []);
assert.equal(detect([0, .1, .299999, .4], [0, 1, 1, 0], null, { minDuration: .2 }).totalCount, 0);
// Absolute epoch timestamps must not create an overly generous time tolerance.
assert.equal(detect([1700000000, 1700000000.000008], [1, 1], null, { minDuration: .00001 }).totalCount, 0);

// Start must remain true while pending. Once confirmed, release controls the latch.
result = detect([0, 1, 2, 3, 4, 5, 6], [0, 1, 0, 1, 1, 0, 0], [0, 0, 0, 0, 0, 0, 1], { minDuration: 1 });
assert.deepEqual(bounds(result), [[3, 5, 4]]);
assert.equal(result.intervals[0].releaseAt, 6);
assert.deepEqual(bounds(detect([0, 1, 2], [1, 1, 1], [1, 0, 1])), [[1, 1, 1]]);

// Unknown samples terminate even hysteresis-latched events; never bridge them.
result = detect([0, 1, 2, 3, 4, 5, 6], [0, 1, 1, NaN, 1, 1, 0], null, { mergeGap: 20 });
assert.deepEqual(bounds(result), [[1, 2, 1], [4, 5, 4]]);
assert.equal(result.unknownCount, 1);
assert.equal(result.intervals[0].releaseAt, null);
assert.equal(result.intervals[0].endReason, 'missing');
assert.equal(result.intervals[0].openEnd, true);
assert.equal(result.intervals[1].openStart, true);
assert.deepEqual(bounds(detect([0, .1, .2, .3, .4], [1, 0, 0, 1, 0], null, { holdoff: .2 })), [[0, 0, 0], [.3, .3, .3]]);
// Very large valid timestamps/durations still respect holdoff without overflow.
assert.equal(detect([0, 1e308, 1.5e308], [1, 0, 1], null, { holdoff: 1e308 }).totalCount, 1);
assert.equal(detect([0, 1, 2], [0, Infinity, 1]).unknownCount, 1);
assert.equal(detect([0, 1, 2], [0, 1, 1], [0, NaN, 0]).unknownCount, 1);

// maxSampleGap is explicitly opt-in. A detected gap splits but does not reorder.
assert.deepEqual(bounds(detect([0, 1, 10, 11], [0, 1, 1, 0])), [[1, 10, 1]]);
result = detect([0, 1, 10, 11], [0, 1, 1, 0], null, { maxSampleGap: 2, mergeGap: 20 });
assert.deepEqual(bounds(result), [[1, 1, 1], [10, 10, 10]]);
assert.equal(result.gapCount, 1);
assert.equal(result.intervals[0].endReason, 'gap');
assert.equal(result.intervals[1].openStart, true);
assert.equal(detect([0, .1, .3], [1, 1, 1], null, { maxSampleGap: .2 }).gapCount, 0);

// Open boundaries describe what the recording cannot establish.
result = detect([10, 11, 12], [1, 1, 1], null, { minDuration: 1 });
assert.deepEqual(bounds(result), [[10, 12, 11]]);
assert.equal(result.intervals[0].openStart, true);
assert.equal(result.intervals[0].openEnd, true);
assert.equal(result.intervals[0].endReason, 'end-of-data');
assert.equal(result.intervals[0].releaseAt, null);
assert.equal(result.intervals[0].boundaryAt, 12);

// Holdoff is from the observed release (not the previous active sample).
result = detect([0, 1, 2, 3, 4, 5, 6, 7], [0, 1, 0, 1, 0, 1, 1, 0], null, { holdoff: 3 });
assert.deepEqual(bounds(result), [[1, 1, 1], [5, 6, 5]]);
assert.equal(result.suppressedCount, 1);
// If a true signal persists past holdoff, its first eligible point is marked open.
result = detect([0, 1, 2, 3, 4, 5, 6], [0, 1, 0, 1, 1, 1, 0], null, { holdoff: 3 });
assert.deepEqual(bounds(result), [[1, 1, 1], [5, 5, 5]]);
assert.equal(result.intervals[1].openStart, true);

// Merge qualifying runs across brief known released gaps. Original active spans stay.
result = detect([0, 1, 2, 3, 4, 5, 6], [0, 1, 1, 0, 1, 1, 0], null, { minDuration: 1, mergeGap: 1 });
assert.deepEqual(bounds(result), [[1, 5, 2]]);
assert.deepEqual(result.intervals[0].segments.map(segment => [segment.t0, segment.t1, segment.confirmedAt]), [[1, 2, 2], [4, 5, 5]]);
assert.equal(result.intervals[0].segmentCount, 2);
assert.equal(result.totalCount, 1);
assert.equal(result.acceptedCount, 2);
assert.equal(result.intervals[0].releaseAt, 6);
assert.equal(detect([0, 1, 2, 3, 4, 5], [0, 1, 0, 1, 0, 0], null, { minDuration: 1, mergeGap: 10 }).totalCount, 0);
assert.equal(detect([0, 1, 2, 3, 4], [0, 1, 0, 1, 0], null, { mergeGap: 0 }).totalCount, 2);
assert.equal(detect([0, 1, 2, 3, 4], [0, 1, 0, 1, 0], null, { mergeGap: 1, holdoff: 3 }).totalCount, 1);

// The cap affects retained results, not evaluation/counting of later events.
result = detect([0, 1, 2, 3, 4, 5, 6, 7], [0, 1, 0, 1, 0, 1, 0, 1], null, { maxResults: 2 });
assert.deepEqual(bounds(result), [[1, 1, 1], [3, 3, 3]]);
assert.equal(result.totalCount, 4);
assert.equal(result.acceptedCount, 4);
assert.equal(result.truncated, true);
result = detect([0, 1, 2, 10, 11, 12, 13, 14], [0, 1, 0, 1, 0, 1, 0, 0], null, { maxResults: 1, mergeGap: 1 });
assert.equal(result.totalCount, 2);
assert.equal(result.acceptedCount, 3);
assert.equal(result.intervals.length, 1);
assert.equal(result.truncated, true);

// Segment budget is shared across retained events and never changes full counts.
result = detect([0, 1, 2, 3, 4, 5, 6, 20, 21, 30, 31], [0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0], null,
    { mergeGap: 1, maxSegments: 2, maxResults: 2 });
assert.equal(result.totalCount, 3);
assert.equal(result.totalSegmentCount, 5);
assert.equal(result.retainedSegmentCount, 2);
assert.equal(result.segmentsTruncated, true);
assert.equal(result.truncated, true);
assert.deepEqual(bounds(result), [[1, 5, 1], [20, 20, 20]]);
assert.equal(result.intervals[0].segmentCount, 3);
assert.deepEqual(result.intervals[0].segments.map(segment => [segment.t0, segment.t1]), [[1, 1], [3, 3]]);
assert.equal(result.intervals[0].segmentsTruncated, true);
assert.equal(result.intervals[1].segmentCount, 1);
assert.deepEqual(result.intervals[1].segments, []);
assert.equal(result.intervals[1].segmentsTruncated, true);
// An exact budget does not falsely announce missing span details.
result = detect([0, 1, 2, 3], [1, 0, 1, 0], null, { maxSegments: 2 });
assert.equal(result.retainedSegmentCount, 2);
assert.equal(result.segmentsTruncated, false);
// Result truncation alone is distinct from segment truncation inside kept events.
result = detect([0, 1, 2, 3], [1, 0, 1, 0], null, { maxResults: 1 });
assert.equal(result.totalSegmentCount, 2);
assert.equal(result.retainedSegmentCount, 1);
assert.equal(result.truncated, true);
assert.equal(result.segmentsTruncated, false);

// Immutable inputs, including typed arrays and missing samples.
const times = new Float64Array([0, 1, 2, 3]);
const values = new Float32Array([0, 1, NaN, 1]);
const originalTimes = [...times], originalValues = [...values];
detect(times, values, null, { maxSampleGap: .5, mergeGap: 4 });
assert.deepEqual([...times], originalTimes);
assert.deepEqual([...values], originalValues);
console.log('event-utils tests passed (duration, hysteresis, missing/gaps, holdoff, merge, boundaries, full count, immutability)');
