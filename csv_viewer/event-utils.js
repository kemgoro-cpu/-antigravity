/* Offline event detection. Values and timestamps are never sorted or changed. */
(function (root) {
    'use strict';

    const DEFAULTS = Object.freeze({ minDuration: 0, holdoff: 0, mergeGap: 0, maxSampleGap: 0, maxResults: 300, maxSegments: 3000 });
    const LABELS = { minDuration: '最低継続時間', holdoff: '再検出までの待ち時間', mergeGap: 'まとめる解除区間', maxSampleGap: '許容サンプル間隔' };
    function normalizeOptions(input = {}) {
        if (!input || typeof input !== 'object' || Array.isArray(input)) throw new RangeError('イベント条件の設定が不正です。');
        const result = {};
        for (const key of Object.keys(LABELS)) {
            const value = input[key] === undefined ? DEFAULTS[key] : input[key];
            if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw new RangeError(`${LABELS[key]}は0以上の有限の秒数で指定してください。`);
            result[key] = value;
        }
        const maxResults = input.maxResults === undefined ? DEFAULTS.maxResults : input.maxResults;
        if (!Number.isSafeInteger(maxResults) || maxResults < 1) throw new RangeError('表示件数の上限は1以上の整数で指定してください。');
        result.maxResults = maxResults;
        const maxSegments = input.maxSegments === undefined ? DEFAULTS.maxSegments : input.maxSegments;
        if (!Number.isSafeInteger(maxSegments) || maxSegments < 1) throw new RangeError('描画区間数の上限は1以上の整数で指定してください。');
        result.maxSegments = maxSegments;
        return result;
    }
    const emptyResult = reason => ({ intervals: [], totalCount: 0, acceptedCount: 0, truncated: false,
        retainedSegmentCount: 0, totalSegmentCount: 0, segmentsTruncated: false,
        unknownCount: 0, gapCount: 0, suppressedCount: 0, reason: reason || '' });
    const arrayLike = values => Array.isArray(values) || (ArrayBuffer.isView(values) && typeof values.length === 'number');
    // Permit only arithmetic rounding at a comparison boundary, never invent an
    // interpolated confirmation time between the observed samples.
    const tolerance = (a, b, span) => Number.EPSILON * Math.max(1, Math.abs(a), Math.abs(b), Math.abs(span));
    const elapsedAtLeast = (end, start, seconds) => end - start >= seconds - tolerance(end, start, seconds);
    const elapsedAtMost = (end, start, seconds) => end - start <= seconds + tolerance(end, start, seconds);

    /**
     * minDuration qualifies each run BEFORE hysteresis latches and BEFORE merge.
     * Release wins when both expressions are true. Unknown inputs interrupt a run.
     * Holdoff is measured from the observed release/interruption timestamp and is
     * applied before merge. mergeGap=0 disables merging; maxSampleGap=0 disables
     * automatic time-gap splitting. Neither setting changes the source samples.
     *
     * t0/t1 are observed endpoints, not estimated threshold crossings. A merged
     * interval's envelope includes known released time; segments retain the actual
     * eligible runs. releaseAt is null for missing/gap/end-of-data boundaries.
     * maxSegments caps the total returned spans across all retained intervals.
     * totalSegmentCount counts every qualified run, including unretained events;
     * segmentsTruncated flags span omission inside a retained interval. Consumers
     * must not replace missing spans with shading over the complete envelope.
     * unknownCount and suppressedCount count samples, not events or seconds.
     */
    function detect(timeData, startValues, releaseValues = null, input = {}) {
        let options;
        try { options = normalizeOptions(input); }
        catch (error) { return emptyResult(error.message); }
        if (!arrayLike(timeData) || !arrayLike(startValues)
            || (releaseValues !== null && !arrayLike(releaseValues))) return emptyResult('時刻と条件値は配列で指定してください。');
        if (timeData.length !== startValues.length || (releaseValues !== null && timeData.length !== releaseValues.length)) {
            return emptyResult('時刻と条件値の点数が一致しません。');
        }
        for (let i = 0; i < timeData.length; i++) {
            if (!Number.isFinite(timeData[i])) return emptyResult('時刻に欠損・非有限値があります。イベントは未評価です。');
            if (i && !(timeData[i] > timeData[i - 1])) return emptyResult('時刻が重複または逆転しています。イベントは未評価です。');
        }

        const result = emptyResult();
        const customRelease = releaseValues !== null;
        let run = null, previousStart = null, lastBoundary = null;
        let mergeBarrier = 0, tailBarrier = -1, tail = null, tailRetained = false;

        function accept(event) {
            result.acceptedCount++;
            result.totalSegmentCount++;
            const merge = options.mergeGap > 0 && tail && tailBarrier === mergeBarrier
                && tail.endReason === 'release' && !event.openStart
                && Number.isFinite(tail.releaseAt)
                && event.t0 >= tail.releaseAt
                && elapsedAtMost(event.t0, tail.releaseAt, options.mergeGap);
            if (merge) {
                if (tailRetained) {
                    if (result.retainedSegmentCount < options.maxSegments) {
                        tail.segments.push(event.segments[0]);
                        result.retainedSegmentCount++;
                    } else {
                        tail.segmentsTruncated = true;
                        result.segmentsTruncated = true;
                    }
                }
                tail.segmentCount++;
                tail.t1 = event.t1;
                tail.endReason = event.endReason;
                tail.openEnd = event.openEnd;
                tail.releaseAt = event.releaseAt;
                tail.boundaryAt = event.boundaryAt;
            } else {
                result.totalCount++;
                tailRetained = result.intervals.length < options.maxResults;
                // Once the display cap is reached, keep only the latest envelope
                // for merge/counting, rather than every later event or segment.
                tail = tailRetained ? event : { ...event, segments: [] };
                tailBarrier = mergeBarrier;
                if (tailRetained) {
                    if (result.retainedSegmentCount < options.maxSegments) {
                        result.retainedSegmentCount++;
                    } else {
                        tail.segments = [];
                        tail.segmentsTruncated = true;
                        result.segmentsTruncated = true;
                    }
                    result.intervals.push(tail);
                }
            }
        }
        function finish(endReason, boundaryAt) {
            if (!run) return;
            if (run.confirmedAt !== null) {
                const releaseAt = endReason === 'release' ? boundaryAt : null;
                const segment = { t0: run.t0, t1: run.lastTime, confirmedAt: run.confirmedAt,
                    endReason, openStart: run.openStart, openEnd: endReason !== 'release', releaseAt, boundaryAt };
                accept({ ...segment, segments: [segment], segmentCount: 1, segmentsTruncated: false });
                lastBoundary = boundaryAt;
            } else {
                // An unqualified true pulse is not a known-false gap. Do not let
                // merge hide it or use it to qualify another, longer envelope.
                mergeBarrier++;
            }
            run = null;
        }

        for (let i = 0; i < timeData.length; i++) {
            const time = timeData[i];
            if (i && options.maxSampleGap > 0 && !elapsedAtMost(time, timeData[i - 1], options.maxSampleGap)) {
                result.gapCount++;
                finish('gap', time);
                mergeBarrier++;
                previousStart = null;
            }
            const startValue = startValues[i], releaseValue = customRelease ? releaseValues[i] : 0;
            if (!Number.isFinite(startValue) || (customRelease && !Number.isFinite(releaseValue))) {
                result.unknownCount++;
                finish('missing', time);
                mergeBarrier++;
                previousStart = null;
                continue;
            }
            const start = startValue !== 0;
            const release = customRelease ? releaseValue !== 0 : !start;

            if (release) {
                finish('release', time);
            } else if (run) {
                if (run.confirmedAt === null && !start) {
                    // Hysteresis only latches AFTER the uninterrupted start
                    // condition satisfies minDuration.
                    finish('release', time);
                } else {
                    run.lastTime = time;
                    if (run.confirmedAt === null && elapsedAtLeast(time, run.t0, options.minDuration)) run.confirmedAt = time;
                }
            } else if (start) {
                // Compare elapsed time directly: adding holdoff to a large
                // absolute timestamp can overflow or erase a small duration.
                if (lastBoundary !== null && !elapsedAtLeast(time, lastBoundary, options.holdoff)) {
                    result.suppressedCount++;
                    mergeBarrier++;
                } else {
                    run = { t0: time, lastTime: time, confirmedAt: options.minDuration === 0 ? time : null,
                        openStart: previousStart !== false };
                }
            }
            previousStart = start;
        }
        if (run) finish('end-of-data', timeData[timeData.length - 1]);
        result.truncated = result.totalCount > result.intervals.length;
        return result;
    }

    const api = { normalizeOptions, detect };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.CSVEvents = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
