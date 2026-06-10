(function (root) {
    'use strict';

    function convertWhitespaceToTabs(text) {
        return text.split('\n')
            .map(line => line.replace(/\|/g, ' ').trim().replace(/\s+/g, '\t'))
            .join('\n');
    }

    function decodeBytes(bytes, encoding, fatal = false) {
        try {
            return {
                ok: true,
                text: new TextDecoder(encoding, { fatal }).decode(bytes),
            };
        } catch (e) {
            return { ok: false, text: '', error: e };
        }
    }

    function countPattern(text, pattern) {
        const matches = text.match(pattern);
        return matches ? matches.length : 0;
    }

    function scoreDecodedText(text) {
        const replacementChars = countPattern(text, /\uFFFD/g);
        const japaneseChars = countPattern(text, /[\u3040-\u30ff\u3400-\u9fff]/g);
        const mojibakeHints = countPattern(text, /[縺繧譁荳蜷逕謗髢陦]/g);
        return japaneseChars * 2 - replacementChars * 80 - mojibakeHints * 3;
    }

    function detectTextEncoding(bytes) {
        if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
            return 'utf-8';
        }
        if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
            return 'utf-16le';
        }
        if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
            return 'utf-16be';
        }

        const utf8 = decodeBytes(bytes, 'utf-8', true);
        if (!utf8.ok) return 'shift-jis';

        const sjis = decodeBytes(bytes, 'shift-jis');
        if (!sjis.ok) return 'utf-8';

        return scoreDecodedText(utf8.text) < -5 && scoreDecodedText(sjis.text) > scoreDecodedText(utf8.text)
            ? 'shift-jis'
            : 'utf-8';
    }

    function isTimeHeader(cell) {
        if (typeof cell !== 'string') return false;
        const cleaned = cell.replace(/[|\s]/g, '').toLowerCase();
        return cleaned.includes('time') || cell.includes('時間');
    }

    function detectHeaderRows(raw, fallbackNameRow = 0, fallbackUnitRow = 1) {
        const scanLimit = Math.min(50, raw.length);
        for (let r = 0; r < scanLimit; r++) {
            const row = raw[r];
            if (!row || row.length < 2) continue;
            const hasTime = row.some(c => isTimeHeader(c));
            if (!hasTime) continue;
            return {
                nameRow: r,
                unitRow: r + 1 < raw.length ? r + 1 : -1,
            };
        }
        return { nameRow: fallbackNameRow, unitRow: fallbackUnitRow };
    }

    function toNumber(v) {
        if (typeof v === 'number') return v;
        if (typeof v !== 'string') return NaN;
        const u = v.trim().toUpperCase();
        if (u === 'TRUE')  return 1;
        if (u === 'FALSE') return 0;
        const n = parseFloat(v);
        return isNaN(n) ? NaN : n;
    }

    function normalizeChannelName(name) {
        return String(name || '')
            .normalize('NFKC')
            .toLowerCase()
            .replace(/[\s_\-()[\]{}<>|/\\:;,.]+/g, '')
            .trim();
    }

    function getStringSimilarity(a, b) {
        const na = normalizeChannelName(a);
        const nb = normalizeChannelName(b);
        if (!na || !nb) return 0;
        if (na === nb) return 1;
        if (na.includes(nb) || nb.includes(na)) return 0.78;

        const aTokens = new Set(na.match(/[a-z]+|\d+|[\u3040-\u30ff\u3400-\u9fff]+/g) || [na]);
        const bTokens = new Set(nb.match(/[a-z]+|\d+|[\u3040-\u30ff\u3400-\u9fff]+/g) || [nb]);
        let overlap = 0;
        for (const token of aTokens) if (bTokens.has(token)) overlap++;
        const union = new Set([...aTokens, ...bTokens]).size;
        return union ? overlap / union : 0;
    }

    function scoreAliasCandidate(mainCol, candidateCol) {
        if (!mainCol || !candidateCol) return 0;
        const nameScore = getStringSimilarity(mainCol.name, candidateCol.name);
        const mainUnit = normalizeChannelName(mainCol.unit || '');
        const candUnit = normalizeChannelName(candidateCol.unit || '');
        const unitScore = mainUnit && candUnit && mainUnit === candUnit ? 0.25 : 0;
        return nameScore + unitScore;
    }

    const api = {
        convertWhitespaceToTabs,
        decodeBytes,
        detectTextEncoding,
        detectHeaderRows,
        getStringSimilarity,
        isTimeHeader,
        normalizeChannelName,
        scoreAliasCandidate,
        scoreDecodedText,
        toNumber,
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    } else {
        root.CSVUtils = api;
    }
})(typeof globalThis !== 'undefined' ? globalThis : this);
