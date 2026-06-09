/**
 * NEDCサイクルのサンプルTRNファイルを生成するスクリプト。
 * Node.js で実行: node generate_nedc.js
 *
 * NEDC = 4 × ECE-15 (Urban, 各195秒) + 1 × EUDC (Extra-Urban, 400秒) = 合計1180秒
 */

const fs = require('fs');

// ─── ECE-15 (Urban) 目標車速プロファイル（195秒） ───
// [開始秒, 終了秒, 開始速度(km/h), 終了速度(km/h)]
const ECE15_PROFILE = [
    [0,   11,   0,   0],    // アイドリング
    [11,  15,   0,  15],    // 加速 → 15 km/h
    [15,  23,  15,  15],    // 定速 15 km/h
    [23,  28,  15,   0],    // 減速 → 停止
    [28,  49,   0,   0],    // アイドリング
    [49,  61,   0,  32],    // 加速 → 32 km/h
    [61,  85,  32,  32],    // 定速 32 km/h
    [85,  96,  32,   0],    // 減速 → 停止
    [96,  117,  0,   0],    // アイドリング
    [117, 130,  0,  50],    // 加速 → 50 km/h
    [130, 143, 50,  50],    // 定速 50 km/h
    [143, 155, 50,  35],    // 減速 → 35 km/h
    [155, 163, 35,  35],    // 定速 35 km/h
    [163, 176, 35,   0],    // 減速 → 停止
    [176, 195,  0,   0],    // アイドリング（サイクル末尾）
];

// ─── EUDC (Extra-Urban) 目標車速プロファイル（400秒） ───
const EUDC_PROFILE = [
    [0,   20,   0,   0],    // アイドリング
    [20,  41,   0,  70],    // 加速 → 70 km/h
    [41,  91,  70,  70],    // 定速 70 km/h
    [91, 111,  70,  50],    // 減速 → 50 km/h
    [111, 131, 50,  50],    // 定速 50 km/h
    [131, 151, 50,  70],    // 加速 → 70 km/h
    [151, 191, 70,  70],    // 定速 70 km/h
    [191, 221, 70, 100],    // 加速 → 100 km/h
    [221, 271, 100, 100],   // 定速 100 km/h
    [271, 291, 100, 120],   // 加速 → 120 km/h
    [291, 341, 120, 120],   // 定速 120 km/h
    [341, 391, 120,   0],   // 減速 → 停止
    [391, 400,   0,   0],   // アイドリング
];

// ─── プロファイルから任意時刻の目標車速を取得する関数 ───
function getTargetSpeed(profile, t) {
    for (const [tStart, tEnd, vStart, vEnd] of profile) {
        if (t >= tStart && t < tEnd) {
            // 区間内で線形補間
            const ratio = (t - tStart) / (tEnd - tStart);
            return vStart + (vEnd - vStart) * ratio;
        }
    }
    return 0;
}

// ─── NEDC全体の目標車速を取得（4×ECE-15 + 1×EUDC） ───
function getNedcTargetSpeed(t) {
    // ECE-15は4回繰り返し（0～780秒）
    if (t < 780) {
        const cycleTime = t % 195;
        return getTargetSpeed(ECE15_PROFILE, cycleTime);
    }
    // EUDCは780秒から開始
    const eudcTime = t - 780;
    return getTargetSpeed(EUDC_PROFILE, eudcTime);
}

// ─── データ生成 ───
const DT = 0.1;             // サンプリング間隔（秒）
const TOTAL_TIME = 1180;     // NEDC全体の時間（秒）
const N = Math.round(TOTAL_TIME / DT) + 1;

// 実測車速のシミュレーション用パラメータ
let actualSpeed = 0;         // 実測車速（km/h）
let engineRPM   = 800;       // エンジン回転数（rpm）

const rows = [];

for (let i = 0; i < N; i++) {
    const t = +(i * DT).toFixed(1);
    const targetSpeed = getNedcTargetSpeed(t);

    // ─── 実測車速: 目標に追従するが少し遅れ＋ノイズ ───
    const speedError = targetSpeed - actualSpeed;
    // 1次遅れ系でモデル化（時定数 = 応答性）
    const tau = targetSpeed > actualSpeed ? 0.8 : 0.6; // 加速は遅め、減速は速め
    actualSpeed += speedError * (DT / tau);
    // 微小ノイズ
    actualSpeed += (Math.random() - 0.5) * 0.15;
    if (actualSpeed < 0) actualSpeed = 0;
    if (targetSpeed === 0 && actualSpeed < 0.3) actualSpeed = 0;

    // ─── アクセル開度: 加速要求に比例 ───
    let throttle = 0;
    if (speedError > 0.5) {
        // 加速中: 速度差と目標速度に応じたアクセル
        throttle = Math.min(100, speedError * 1.5 + targetSpeed * 0.15);
    } else if (speedError > -1 && targetSpeed > 1) {
        // 定速巡航: 走行抵抗を補う程度のアクセル
        throttle = targetSpeed * 0.12 + 2;
    }
    throttle += (Math.random() - 0.5) * 0.8;
    if (throttle < 0) throttle = 0;
    if (actualSpeed < 0.1 && targetSpeed < 0.1) throttle = 0;

    // ─── エンジン回転数: 速度とギア比に基づくモデル ───
    const idleRPM = 800;
    let targetRPM;
    if (actualSpeed < 1) {
        targetRPM = idleRPM;
    } else if (actualSpeed < 18) {
        // 1速〜2速
        targetRPM = idleRPM + actualSpeed * 120;
    } else if (actualSpeed < 40) {
        // 3速
        targetRPM = 1200 + (actualSpeed - 18) * 55;
    } else if (actualSpeed < 70) {
        // 4速
        targetRPM = 1500 + (actualSpeed - 40) * 40;
    } else {
        // 5速
        targetRPM = 1800 + (actualSpeed - 70) * 28;
    }
    // 回転数もなめらかに追従
    engineRPM += (targetRPM - engineRPM) * 0.3;
    engineRPM += (Math.random() - 0.5) * 10;
    if (engineRPM < idleRPM) engineRPM = idleRPM;

    // ─── 燃料消費率: 回転数とアクセル開度から推定 ───
    let fuelRate;
    if (actualSpeed < 0.5 && throttle < 1) {
        // アイドリング
        fuelRate = 0.5 + (Math.random() - 0.5) * 0.05;
    } else {
        // 燃費マップを簡易モデル化
        fuelRate = 0.4 + engineRPM / 3000 * 2.5 + throttle / 100 * 6;
        fuelRate += (Math.random() - 0.5) * 0.2;
    }
    if (fuelRate < 0.3) fuelRate = 0.3;

    rows.push({
        time:        t.toFixed(1),
        target:      targetSpeed.toFixed(2),
        actual:      actualSpeed.toFixed(2),
        throttle:    throttle.toFixed(2),
        rpm:         engineRPM.toFixed(0),
        fuelRate:    fuelRate.toFixed(3),
    });
}

// ─── TRNファイル出力関数 ───
function writeTRN(filePath, dataRows) {
    const header = '| Time    Target_Speed    Actual_Speed    Throttle    Engine_RPM    Fuel_Rate';
    const units  = '  s       km/h            km/h            %           rpm           L/h';
    const lines = [header, units];
    for (const r of dataRows) {
        const line = `  ${r.time.padStart(7)}    ${r.target.padStart(8)}    ${r.actual.padStart(8)}    ${r.throttle.padStart(8)}    ${r.rpm.padStart(8)}    ${r.fuelRate.padStart(8)}`;
        lines.push(line);
    }
    fs.writeFileSync(filePath, lines.join('\n'), 'utf-8');
    console.log(`Generated: ${filePath} (${dataRows.length} rows)`);
}

// ─── 3つのファイルを生成 ───
// ファイル1: 基準データ（オフセットなし）
writeTRN(__dirname + '/NEDC_sample_A.trn', rows);

// ファイル2: 時間オフセット +3.5秒（ログ開始タイミングのズレ）＋ 別のノイズシード
{
    const OFFSET = 3.5; // 秒
    let aSpd = 0, rpm2 = 800;
    const rows2 = [];
    for (let i = 0; i < N; i++) {
        const t = +(i * DT).toFixed(1);
        const tShifted = t - OFFSET; // 時間をずらして目標車速を取得
        const targetSpeed = tShifted >= 0 ? getNedcTargetSpeed(tShifted) : 0;

        const err = targetSpeed - aSpd;
        const tau = targetSpeed > aSpd ? 0.9 : 0.55;
        aSpd += err * (DT / tau);
        aSpd += (Math.random() - 0.5) * 0.18;
        if (aSpd < 0) aSpd = 0;
        if (targetSpeed === 0 && aSpd < 0.3) aSpd = 0;

        let thr = 0;
        if (err > 0.5) {
            thr = Math.min(100, err * 1.6 + targetSpeed * 0.14);
        } else if (err > -1 && targetSpeed > 1) {
            thr = targetSpeed * 0.13 + 1.8;
        }
        thr += (Math.random() - 0.5) * 0.9;
        if (thr < 0) thr = 0;
        if (aSpd < 0.1 && targetSpeed < 0.1) thr = 0;

        let tRPM;
        if (aSpd < 1) tRPM = 800;
        else if (aSpd < 18) tRPM = 800 + aSpd * 125;
        else if (aSpd < 40) tRPM = 1250 + (aSpd - 18) * 52;
        else if (aSpd < 70) tRPM = 1500 + (aSpd - 40) * 42;
        else tRPM = 1800 + (aSpd - 70) * 30;
        rpm2 += (tRPM - rpm2) * 0.3;
        rpm2 += (Math.random() - 0.5) * 12;
        if (rpm2 < 800) rpm2 = 800;

        let fr;
        if (aSpd < 0.5 && thr < 1) {
            fr = 0.52 + (Math.random() - 0.5) * 0.05;
        } else {
            fr = 0.42 + rpm2 / 3000 * 2.6 + thr / 100 * 5.8;
            fr += (Math.random() - 0.5) * 0.22;
        }
        if (fr < 0.3) fr = 0.3;

        rows2.push({
            time:     t.toFixed(1),
            target:   targetSpeed.toFixed(2),
            actual:   aSpd.toFixed(2),
            throttle: thr.toFixed(2),
            rpm:      rpm2.toFixed(0),
            fuelRate: fr.toFixed(3),
        });
    }
    writeTRN(__dirname + '/NEDC_sample_B.trn', rows2);
}

// ファイル3: 時間オフセット -1.2秒 ＋ ドライバーの追従特性が違う（応答が鈍い）
{
    const OFFSET = -1.2;
    let aSpd = 0, rpm3 = 800;
    const rows3 = [];
    for (let i = 0; i < N; i++) {
        const t = +(i * DT).toFixed(1);
        const tShifted = t - OFFSET;
        const targetSpeed = tShifted >= 0 && tShifted <= TOTAL_TIME ? getNedcTargetSpeed(tShifted) : 0;

        const err = targetSpeed - aSpd;
        const tau = targetSpeed > aSpd ? 1.2 : 0.7; // 応答が鈍い
        aSpd += err * (DT / tau);
        aSpd += (Math.random() - 0.5) * 0.2;
        if (aSpd < 0) aSpd = 0;
        if (targetSpeed === 0 && aSpd < 0.3) aSpd = 0;

        let thr = 0;
        if (err > 0.5) {
            thr = Math.min(100, err * 1.8 + targetSpeed * 0.16);
        } else if (err > -1 && targetSpeed > 1) {
            thr = targetSpeed * 0.11 + 2.5;
        }
        thr += (Math.random() - 0.5) * 1.0;
        if (thr < 0) thr = 0;
        if (aSpd < 0.1 && targetSpeed < 0.1) thr = 0;

        let tRPM;
        if (aSpd < 1) tRPM = 800;
        else if (aSpd < 18) tRPM = 800 + aSpd * 115;
        else if (aSpd < 40) tRPM = 1200 + (aSpd - 18) * 58;
        else if (aSpd < 70) tRPM = 1480 + (aSpd - 40) * 38;
        else tRPM = 1780 + (aSpd - 70) * 26;
        rpm3 += (tRPM - rpm3) * 0.25;
        rpm3 += (Math.random() - 0.5) * 15;
        if (rpm3 < 800) rpm3 = 800;

        let fr;
        if (aSpd < 0.5 && thr < 1) {
            fr = 0.48 + (Math.random() - 0.5) * 0.06;
        } else {
            fr = 0.38 + rpm3 / 3000 * 2.4 + thr / 100 * 6.2;
            fr += (Math.random() - 0.5) * 0.25;
        }
        if (fr < 0.3) fr = 0.3;

        rows3.push({
            time:     t.toFixed(1),
            target:   targetSpeed.toFixed(2),
            actual:   aSpd.toFixed(2),
            throttle: thr.toFixed(2),
            rpm:      rpm3.toFixed(0),
            fuelRate: fr.toFixed(3),
        });
    }
    writeTRN(__dirname + '/NEDC_sample_C.trn', rows3);
}
