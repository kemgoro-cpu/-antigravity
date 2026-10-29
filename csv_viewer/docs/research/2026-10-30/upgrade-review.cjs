'use strict';

// This audit changes the proposed delivery method, not implementation progress.
const proposals = require('./recommendations.cjs');
const consolidation = require('./consolidation-status.json');
const items = ['01-18', '19-37', '38-55'].flatMap(part => require(`./upgrade-audit-${part}.json`));
const auditedRevision = '24a3fe0c69837dc9e11c3b7ba719e0fe5f053f88';
const auditedDate = '2026-10-30';
const labels = {
 replace: '置換・統合',
 extend: '既存画面の拡張',
 internal: '内部改善',
 optional: '用途がある場合だけ',
 defer: '今回は見送り'
};
const descriptions = {
 replace: '既存の入口・表示・手順を更新し、重複する旧UIを整理する',
 extend: '今ある操作の中に選択肢や情報を加える',
 internal: '常設の操作を増やさず、処理や信頼性を改善する',
 optional: '対象ログや利用頻度を確認できた場合だけ導入する',
 defer: '独立した画面管理や新たな基盤が必要なため保留する'
};
const byRank = new Map();
for (const item of items) {
 const proposal = proposals.find(p => p.rank === item.rank);
 if (!proposal || proposal.originalRank !== item.originalRank || byRank.has(item.rank) || !labels[item.mode]) throw new Error('Invalid upgrade audit rank or mode: ' + item.rank);
 for (const field of ['target', 'retire', 'preserve', 'rationale']) if (typeof item[field] !== 'string' || !item[field].trim()) throw new Error('Missing audit field: ' + item.rank + ' ' + field);
 if (!item.evidence.length || item.evidence.some(ref => !/^csv_viewer\/[\w./-]+$/.test(ref.path) || !Number.isInteger(ref.line) || ref.line < 1)) throw new Error('Invalid code evidence: ' + item.rank);
 byRank.set(item.rank, item);
}
if (byRank.size !== proposals.length) throw new Error('Upgrade audit must cover all proposals');
const counts = items.reduce((acc, item) => (acc[item.mode]++, acc), Object.fromEntries(Object.keys(labels).map(key => [key, 0])));
const inPlaceCount = counts.replace + counts.extend + counts.internal;
const e = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const ranks = values => values.map(rank => `<a href="#idea-${rank}">${rank}位</a>`).join('・');
const consolidatedCount = consolidation.items.filter(item => item.status === 'complete').length;
const delivery = `<div class="upgrade-delivery"><h3>今回依頼された3つの整理：${consolidatedCount} / 3 完了</h3><p>下のチェックは入口・パネルの整理の実装状況です。55案すべての機能が実装済みという意味ではありません。</p><ul class="task-checklist">${consolidation.items.map(item => `<li data-consolidation="${item.order}" data-status="${item.status}"><input type="checkbox" class="progress-check" disabled${item.status === 'complete' ? ' checked' : ''} aria-label="${e(item.title)}：${item.status === 'complete' ? '完了' : '未完了'}"><div><strong>${item.order}. ${e(item.title)}</strong><p>${e(item.detail)}</p></div></li>`).join('')}</ul><p class="muted">更新：${e(consolidation.updatedDate)} · 実装コミット ${e(consolidation.implementationCommit)}。元の保存形式、計測値、原データは維持します。</p></div>`;
const detail = rank => {
 const item = byRank.get(rank);
 const refs = item.evidence.map(ref => `<a href="https://github.com/kemgoro-cpu/-antigravity/blob/${auditedRevision}/${e(ref.path)}#L${ref.line}" target="_blank" rel="noopener noreferrer">${e(ref.path.replace('csv_viewer/', ''))}:${ref.line}</a>`).join(' / ');
 return `<div class="upgrade-detail"><strong>導入方法（監査時の提案）</strong><span class="upgrade-tag mode-${item.mode}">${labels[item.mode]}</span><p><b>組み込む先：</b>${e(item.target)}</p><p><b>整理するUI・手順：</b>${e(item.retire)}</p><details class="upgrade-reasons"><summary>残す能力・判断理由・コード根拠</summary><dl><dt>残す能力</dt><dd>${e(item.preserve)}</dd><dt>監査時の判断</dt><dd>${e(item.rationale)}</dd><dt>コード根拠</dt><dd>${refs}</dd></dl></details></div>`;
};

const bundles = [
 {
  order: 1, title: '読み込みの入口を一つに', related: [1, 5, 40, 42],
  change: '「ファイルを選択」と「設定を確認してファイルを開く」の2入口を、一つの「開く」に整理。確認付き／設定を再利用して読込をその中で選ぶ。常設設定とプレビュー内の同じ項目は一つの編集部品にする。',
  keep: 'ドラッグ読込、単位行なし、文字コード・時間列、機器別プリセット、共通の初期設定とファイル別上書き。貼付や差し替えもこの読込経路を使う。'
 },
 {
  order: 2, title: '元データ・品質・統計を同じ調査パネルへ', related: [3, 4, 21, 23, 26],
  change: '現在の「元データ」「品質」と独立した統計パネルを、「調べる」の中の3タブへ整理。浮動統計パネルを置き換える。選択行が見える位置へスクロールする3位の残りも先に補完する。',
  keep: '区間操作バーから統計を開く操作、2点カーソルのA/B/Δ、元サンプルと補間値の区別。XYは既存の大きな画面を拡張し、小さなパネルへ無理に詰め込まない。'
 },
 {
  order: 3, title: '保存・再利用・出力を目的で選べるように', related: [9, 15, 20, 30, 36, 37, 45],
  change: '保存・再利用の入口を共通化し、「今回の作業」「次の試験の比較条件」「チャンネルだけ」を選ぶ。同じHTML出力の名称を揃え、CSV・画像・HTMLの設定も既存出力メニューにまとめる。',
  keep: '保存内容と適用時の効果はタイプ別に維持。お気に入り適用で単独チャートへ配置が変わる点も明示する。従来JSON等との互換を残し、未実装のプロジェクト保存で代替済みとしない。'
 },
 {
  order: 4, title: '比較結果と時間合わせをその場で強化', related: [16, 18, 19],
  change: '現在の比較結果を「カード／一覧」の切替にし、多数の結果を見渡せるようにする。許容差の方式と、自動時間合わせの曖昧さの確認は既存の編集・プレビュー内で扱う。',
  keep: '個別結果への詳細表示、差分の符号、未評価と合格の区別。別の判定ダッシュボードは増やさない。一括評価・ばらつき帯は反復試験の需要がある場合に限る。'
 },
 {
  order: 5, title: '単位・条件・計算の既存編集を更新', related: [6, 7, 10, 12, 14, 22, 28, 32],
  change: '確認付き単位換算は既存の単位・計算チャンネルへ、時間条件はイベント編集へ、計算レシピはCustom RAMへ組み込む。複数区間も既存の区間選択から保存・再選択する。',
  keep: '換算前の原値、数値計算と真偽条件の意味、従来の統計・補間の既定値。条件を一律にまとめて、表示範囲や解析区間の意味を変えない。'
 },
 {
  order: 6, title: '性能と再計算は内部の置き換えで改善', related: [34, 35, 47],
  change: '実際の待ち時間を測り、Worker・極値を保つ描画・依存関係による再計算へ順に置き換える。常設の専用モードボタンを増やさず、進行状況や取消は処理中に表示する。',
  keep: '解析は間引き前の値で行う。file://・オフライン、設定保存・復元、取消後の整合性。性能向上は実測してから完了とする。'
 }
];

const summary = `<section id="upgrade-review" class="upgrade-summary">
 <div class="eyebrow">2026-10-30 · 既存機能との照合 · 依頼された整理 ${consolidatedCount} / 3 完了</div>
 <h2>機能追加の前に、既存画面をアップグレードする</h2>
 <p class="lead">55案中${inPlaceCount}案は、既存の操作・画面・内部処理に組み込む方針です。</p>
 <p>全55案を実装コードと照合し、別の入口や画面を足す前に現在の操作を置き換えられるかで判断しました。依頼された3つの整理は下のチェックへ反映しています。<strong>55案の導入方針と、そのすべての実装完了は別です。</strong>元の順位は維持します。</p>
 ${delivery}
 <div class="upgrade-counts">${Object.keys(labels).map(mode => `<button data-upgrade-view="${mode}" class="mode-${mode}"><b>${counts[mode]}案</b><span>${labels[mode]}</span><small>${descriptions[mode]}</small></button>`).join('')}</div>
 <p class="muted">「置換・統合」は旧UIや手順を整理する案。「既存画面の拡張」は選択肢が増えるため、必要時だけ開く配置にします。件数は55案の分類で、削除できるボタン数や実装済み件数ではありません。</p>
 <button class="primary-action" data-upgrade-view="in-place">既存機能に組み込む${inPlaceCount}案を見る</button>
 <h3 class="upgrade-subheading">画面を増やさない改修順（監査時の提案）</h3>
 <p>以下は監査時の広い改修案です。今回の3つの整理に含まれない貼り付け・ファイル差し替え・時間重み統計・比較CSV等は引き続き未実装です。専門用途の案はこの順番だけを理由に着手しません。</p>
 <div class="upgrade-bundles">${bundles.map(bundle => `<article class="upgrade-bundle"><h4><span>${bundle.order}</span>${bundle.title}</h4><p>${e(bundle.change)}</p><p class="preserve"><b>残すもの：</b>${e(bundle.keep)}</p><p class="muted">関連：${ranks(bundle.related)}</p></article>`).join('')}</div>
 <details class="upgrade-boundaries"><summary>まとめても区別を消してはいけないもの</summary><ul>
 <li><b>表示範囲と解析区間：</b>拡大表示だけ変えて解析区間を固定する用途があるため、同じ区間へ強制しない。上側の範囲スライダーを戻さず、下側ナビゲーターを主操作のまま使う。</li>
 <li><b>作業復元と再利用：</b>作業復元はファイル・位置・条件を戻す。比較テンプレートは新しい試験へ条件を適用し、シフトを戻す。お気に入りが保存するのは列名・順序だが、適用時は既存チャートを単独チャートへ再構成するため、配置変更も示す。入口の統合と保存内容の統一は別に判断する。</li>
 <li><b>元データと補間値：</b>生データ表は元の観測点。比較やカーソルには補間値を使う場面がある。表を追加したことを理由にホバーや2点計測を削らない。</li>
 <li><b>差分表示と差分の計算チャンネル：</b>一時表示と後続計算に使うデータは別用途。メニューは寄せても両方の能力を残す。</li>
 <li><b>CSV・PNG・HTML・設定JSON：</b>成果物が異なるため形式は残す。Ctrl+SのPNG保存など、既存ショートカットの意味を無断で変えない。</li>
 </ul></details>
 <p class="upgrade-hold"><b>今回は見送り：</b>${ranks(items.filter(item => item.mode === 'defer').map(item => item.rank))}。現行のログ比較を置き換える範囲を超えるため、必要性が具体化してから再評価します。FFT・日時・連結なども、実際の対象ログがある場合だけ検討します。</p>
 <p><b>旧UIを廃止する条件：</b>代わりの操作で既存の作業ができ、数値結果・読込・保存復元・Undo・キーボード操作を確認した後に、重複する旧UIを取り除く。旧設定の読み込み口は互換性のため残す。名称や配置を変えただけで「機能統合完了」としない。</p>
 <p class="muted">監査対象：<a href="https://github.com/kemgoro-cpu/-antigravity/tree/${auditedRevision}/csv_viewer" target="_blank" rel="noopener noreferrer">${auditedRevision.slice(0, 7)}の実装</a>。各案に組み込み先・整理対象・残す能力・コード根拠を追記。将来の使いやすさは設計判断で、利用時間を実測した効果ではありません。</p>
 </section>`;

const filter = `<label>導入方法（提案）<br><select id="upgrade"><option value="">すべて</option><option value="in-place">既存機能に組み込む</option>${Object.entries(labels).map(([key, label]) => `<option value="${key}">${label}</option>`).join('')}</select></label>`;
const styles = `.upgrade-summary{background:#fff;border:2px solid #85b5ac;border-radius:10px;padding:26px;margin:26px 0}.upgrade-summary h2{margin:8px 0 12px}.upgrade-counts{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:10px;margin:22px 0 12px}.upgrade-counts button{text-align:left;padding:14px 12px;min-width:0}.upgrade-counts b{font-size:28px;display:block}.upgrade-counts span{display:block;font-size:14px;font-weight:700}.upgrade-counts small{display:block;font-size:12px;line-height:1.6;margin-top:8px}.mode-replace{background:#e9f5ee;color:#205a43}.mode-extend{background:#eaf3fa;color:#235773}.mode-internal{background:#edf2f1;color:#34564f}.mode-optional{background:#fff4e2;color:#78501a}.mode-defer{background:#f0eef3;color:#63556e}.upgrade-subheading{margin:28px 0 10px}.upgrade-bundles{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}.upgrade-bundle{border:1px solid var(--line);border-radius:7px;padding:18px}.upgrade-bundle h4{margin:0 0 10px;font-size:17px;line-height:1.5;display:flex;gap:10px;align-items:flex-start}.upgrade-bundle h4 span{background:#e5f2ef;color:#255c51;flex-shrink:0;width:25px;text-align:center;border-radius:4px}.upgrade-bundle p{font-size:14px}.upgrade-bundle .preserve{padding-top:10px;border-top:1px solid var(--line);color:#455665}.upgrade-boundaries{margin:22px 0;padding:16px;background:#f3f7f8;border-radius:6px}.upgrade-hold{background:#f4f1f5;border-left:4px solid #877392;padding:14px}.upgrade-detail{border-top:1px solid var(--line);padding:16px 0;margin:16px 0 0;font-size:14px}.upgrade-detail>strong{margin-right:10px}.upgrade-tag{display:inline-block;border-radius:4px;padding:2px 8px;font-size:12px;font-weight:600}.upgrade-reasons{margin-top:12px}.upgrade-reasons dl{font-size:13px}.filters label:not(.search){flex:0 1 auto}.filters select{width:100%}.filters label.search{min-width:210px}.filters button{align-self:end}.candidate{scroll-margin-top:205px}@media(max-width:1000px){.upgrade-counts{grid-template-columns:repeat(3,minmax(0,1fr))}}@media(max-width:760px){.upgrade-summary{padding:17px}.upgrade-counts{grid-template-columns:repeat(2,minmax(0,1fr))}.upgrade-counts b{font-size:24px}.upgrade-bundles{grid-template-columns:1fr}.upgrade-bundle{padding:14px}.upgrade-boundaries{padding:12px}.upgrade-boundaries ul{padding-left:20px}.filters label.search{flex-basis:100%}.filters label:not(.search){flex:1 1 140px;min-width:0}.candidate{scroll-margin-top:12px}}@media print{.upgrade-summary button{display:none}.upgrade-summary{border:1px solid #aaa}.upgrade-bundles{display:block}.upgrade-bundle{break-inside:avoid;margin:10px 0}.upgrade-detail{break-inside:avoid}}`;

module.exports = {items, byRank, labels, counts, inPlaceCount, auditedDate, auditedRevision, bundles, detail, summary, filter, styles: styles + '.upgrade-delivery{background:#eff7f3;border:1px solid #a8c9bd;padding:18px;border-radius:7px;margin:20px 0}.upgrade-delivery li{padding:9px 0}.upgrade-delivery li p{font-size:14px;margin:4px 0 0}', consolidation};
