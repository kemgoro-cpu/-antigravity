/* Read-only diagnostics. No sorting, interpolation, or repair of source arrays. */
(function (root) {
    'use strict';
    const finite = Number.isFinite;
    const isList = a => Array.isArray(a) || (ArrayBuffer.isView(a) && !(a instanceof DataView));
    const lengthOf = a => isList(a) ? a.length : 0;
    const countOption = n => Number.isSafeInteger(n) && n >= 0 ? n : 0;
    const sourceRow = (rows, index) => Number.isSafeInteger(rows?.[index]) && rows[index] > 0 ? rows[index] : null;
    function issueCollector(limit) {
        const maxIssues = Number.isSafeInteger(limit) && limit >= 0 ? Math.min(limit, 10000) : 1000;
        const issues = [];
        return { issues, maxIssues, add: issue => { if (issues.length < maxIssues) issues.push(issue); } };
    }

    /**
     * Entire normalized time axis, in seconds. Duplicate = each finite occurrence
     * after the first, including non-adjacent duplicates. Reverse = adjacent finite
     * pair with current < previous. Non-finite samples break adjacency.
     * A large gap is strictly greater than median(positive finite adjacent dt) *
     * gapFactor. This is a diagnostic heuristic, not proof of missing acquisition.
     * invalidTimeCount/Rows describe records the importer omitted, and are added
     * to non-finite timestamps still present in timeData (do not pass them twice).
     * sourceRow is the 1-based nonempty record number, not the physical text line.
     */
    function analyzeTime(timeData, options = {}) {
        options = options || {};
        const count = lengthOf(timeData), collected = issueCollector(options.maxIssues);
        const gapFactor = finite(options.gapFactor) && options.gapFactor > 0 ? options.gapFactor : 10;
        // Exactly one numeric working buffer; sort its populated view in-place.
        // The original timeData is never sorted or copied wholesale.
        const intervals = new Float64Array(Math.max(0, count - 1));
        let positiveIntervalCount = 0, lastFinite = -Infinity, needsDuplicateSet = false;
        for (let i = 0; i < count; i++) {
            const time = timeData[i];
            if (!finite(time)) continue;
            if (time <= lastFinite) needsDuplicateSet = true;
            lastFinite = time;
            if (!i || !finite(timeData[i - 1])) continue;
            const dt = time - timeData[i - 1];
            if (finite(dt) && dt > 0) intervals[positiveIntervalCount++] = dt;
        }
        let typicalInterval = null;
        if (positiveIntervalCount) {
            const sorted = intervals.subarray(0, positiveIntervalCount);
            sorted.sort();
            const mid = positiveIntervalCount >>> 1;
            typicalInterval = positiveIntervalCount % 2 ? sorted[mid] : sorted[mid - 1] + (sorted[mid] - sorted[mid - 1]) / 2;
        }
        const product = typicalInterval === null ? null : typicalInterval * gapFactor;
        const gapThreshold = finite(product) ? product : null;
        // The common strictly increasing case cannot contain duplicates, so it
        // does not need a Set holding one entry for every sample.
        const seen = needsDuplicateSet ? new Set() : null;
        let finiteCount = 0, nonFiniteTimeCount = 0, duplicateCount = 0, reverseCount = 0, largeGapCount = 0, invalidIntervalCount = 0;
        let minTime = Infinity, maxTime = -Infinity;
        for (let i = 0; i < count; i++) {
            const time = timeData[i], row = sourceRow(options.sourceRowNumbers, i);
            if (!finite(time)) {
                nonFiniteTimeCount++;
                if (collected.issues.length < collected.maxIssues) collected.add({ kind: 'invalid-time', index: i, time: null, sourceRow: row, origin: 'time-data' });
                continue;
            }
            finiteCount++; minTime = Math.min(minTime, time); maxTime = Math.max(maxTime, time);
            if (seen?.has(time)) {
                duplicateCount++;
                if (collected.issues.length < collected.maxIssues) collected.add({ kind: 'duplicate-time', index: i, time, sourceRow: row });
            } else seen?.add(time);
            if (!i || !finite(timeData[i - 1])) continue;
            const previousTime = timeData[i - 1], dt = time - previousTime;
            const invalid = !finite(dt), reverse = time < previousTime, gap = gapThreshold !== null && dt > gapThreshold;
            if (invalid) invalidIntervalCount++;
            if (reverse) reverseCount++;
            if (gap) largeGapCount++;
            if ((!invalid && !reverse && !gap) || collected.issues.length >= collected.maxIssues) continue;
            const pair = { index: i, time, previousTime, sourceRow: row, previousSourceRow: sourceRow(options.sourceRowNumbers, i - 1), interval: invalid ? null : dt };
            if (invalid) collected.add({ kind: 'invalid-interval', ...pair });
            if (reverse) collected.add({ kind: 'reverse-time', ...pair });
            if (gap) collected.add({ kind: 'large-gap', ...pair, threshold: gapThreshold });
        }
        const omittedRows = isList(options.invalidTimeRows) ? options.invalidTimeRows : [];
        const omittedTimeCount = Math.max(countOption(options.invalidTimeCount), omittedRows.length);
        for (let i = 0; i < omittedRows.length && collected.issues.length < collected.maxIssues; i++) {
            const row = Number.isSafeInteger(omittedRows[i]) && omittedRows[i] > 0 ? omittedRows[i] : null;
            collected.add({ kind: 'invalid-time', index: null, time: null, sourceRow: row, origin: 'import' });
        }
        const invalidTimeCount = nonFiniteTimeCount + omittedTimeCount;
        const issueCount = duplicateCount + reverseCount + largeGapCount + invalidIntervalCount + invalidTimeCount;
        return { count, finiteCount, invalidTimeCount, nonFiniteTimeCount, omittedTimeCount,
            duplicateCount, reverseCount, positiveIntervalCount, typicalInterval, gapFactor, gapThreshold,
            largeGapCount, invalidIntervalCount, minTime: finiteCount ? minTime : null, maxTime: finiteCount ? maxTime : null,
            issueCount, issues: collected.issues, issuesTruncated: issueCount > collected.issues.length,
            unlocatedIssueCount: omittedTimeCount - omittedRows.length, maxIssues: collected.maxIssues,
            sourceRowNumbering: 'nonempty-record-1based' };
    }

    /**
     * Full-resolution channel samples; range is [start,end] in shifted seconds
     * (timeData[i] + offset), closed at both endpoints. Reversed bounds normalize.
     * No range: every time-indexed value counts, even if its timestamp is invalid.
     * With range: non-finite shifted timestamps cannot be assigned to it and are
     * counted in excludedTimeCount. A short values array contributes missing values;
     * values beyond timeData have no time coordinate and appear as extraValueCount.
     * missingRate is 0..1, null when no samples. constant means all finite values
     * are equal (including a single valid value); it does not diagnose a fault.
     */
    function analyzeValues(timeData, values, options = {}) {
        options = options || {};
        const count = lengthOf(timeData), valueCount = lengthOf(values), collected = issueCollector(options.maxIssues);
        const offset = options.offset === undefined ? 0 : options.offset;
        let range = null, error = null;
        if (!finite(offset)) error = 'invalid-offset';
        if (options.range != null) {
            const r = options.range;
            if (!isList(r) || r.length !== 2 || typeof r[0] !== 'number' || typeof r[1] !== 'number' || Number.isNaN(r[0]) || Number.isNaN(r[1])) error = 'invalid-range';
            else range = [Math.min(r[0], r[1]), Math.max(r[0], r[1])];
        }
        let sampleCount = 0, validCount = 0, missingCount = 0, excludedTimeCount = 0, nonFiniteTimeCount = 0;
        let min = Infinity, max = -Infinity;
        if (!error) for (let i = 0; i < count; i++) {
            const rawTime = timeData[i], time = finite(rawTime) ? rawTime + offset : NaN;
            if (!finite(time)) {
                nonFiniteTimeCount++;
                if (range) { excludedTimeCount++; continue; }
            }
            if (range && (time < range[0] || time > range[1])) continue;
            sampleCount++;
            const value = i < valueCount ? values[i] : undefined;
            if (!finite(value)) {
                missingCount++;
                if (collected.issues.length < collected.maxIssues) collected.add({ kind: 'missing-value', index: i, time: finite(time) ? time : null,
                    rawTime: finite(rawTime) ? rawTime : null, sourceRow: sourceRow(options.sourceRowNumbers, i) });
            } else { validCount++; min = Math.min(min, value); max = Math.max(max, value); }
        }
        const constant = validCount > 0 && min === max;
        return { count, valueCount, sampleCount, validCount, missingCount,
            missingRate: sampleCount ? missingCount / sampleCount : null,
            min: validCount ? min : null, max: validCount ? max : null, constant, constantValue: constant ? min : null,
            excludedTimeCount, nonFiniteTimeCount, extraValueCount: Math.max(0, valueCount - count),
            range, offset, error, issueCount: missingCount, issues: collected.issues,
            issuesTruncated: missingCount > collected.issues.length, maxIssues: collected.maxIssues,
            sourceRowNumbering: 'nonempty-record-1based' };
    }
    const api = { analyzeTime, analyzeValues };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.CSVDataQuality = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
