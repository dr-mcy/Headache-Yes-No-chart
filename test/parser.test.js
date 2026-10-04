const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../parser.js');

const FULL_SAMPLE = [
  '頭痛チェックシート',
  '記入日: 2026/09/27',
  '生年月日: 1980/5/3',
  '氏名: テスト 太郎',
  '性別: 男',
  '病院ID: H-0001',
  '担当医: テスト医師',
  '【過去4週間】',
  '頭痛があった日: 5日',
  '痛み止め服用日: 3日',
  'スッキリせず: 4日',
  'スッキリ: 19日',
  '【HIT-6】 58点 かなり',
  '回答: 1,2,3,4,5,3',
  '【MIBS-4】 4点 中等度',
  '回答: 1,2,3,4',
  '【備考】 自由記述（任意、複数行あり得る）'
].join('\n');

test('①の実出力形式をそのまま parse できる', () => {
  const r = P.parseQrText(FULL_SAMPLE);
  assert.equal(r.date, '2026/09/27');
  assert.equal(r.sortKey, 20260927);
  assert.deepEqual(r.birthDate, { y: 1980, m: 5, d: 3, display: '1980/5/3' });
  assert.equal(r.name, 'テスト 太郎');
  assert.equal(r.sex, '男');
  assert.equal(r.hospitalId, 'H-0001');
  assert.equal(r.doctor, 'テスト医師');
  assert.equal(r.mhd, 5);
  assert.equal(r.mmd, 3);
  assert.equal(r.notClearDays, 4);
  assert.equal(r.clearDays, 19);
  assert.equal(r.hit6, 58);
  assert.equal(r.hit6Verdict, 'かなり');
  assert.deepEqual(r.hit6Answers, [1, 2, 3, 4, 5, 3]);
  assert.equal(r.mibs4, 4);
  assert.equal(r.mibs4Verdict, '中等度');
  assert.deepEqual(r.mibs4Answers, [1, 2, 3, 4]);
  assert.equal(r.note, '自由記述（任意、複数行あり得る）');
  assert.equal(r.patientKey, 'hid:H-0001');
});

test('記入日が空で生年月日がある場合、生年月日を記入日として拾わない', () => {
  const text = FULL_SAMPLE.replace('記入日: 2026/09/27', '記入日: -');
  const r = P.parseQrText(text);
  assert.equal(r.date, null);
  assert.equal(r.sortKey, null);
  assert.equal(r.birthDate.display, '1980/5/3');
});

test('HIT-6/MIBS-4 未完を null として扱う', () => {
  const text = FULL_SAMPLE
    .replace('【HIT-6】 58点 かなり', '【HIT-6】 未完')
    .replace('回答: 1,2,3,4,5,3', '回答: -,-,-,-,-,-')
    .replace('【MIBS-4】 4点 中等度', '【MIBS-4】 未完')
    .replace('回答: 1,2,3,4', '回答: -,-,-,-');
  const r = P.parseQrText(text);
  assert.equal(r.hit6, null);
  assert.equal(r.hit6Verdict, null);
  assert.deepEqual(r.hit6Answers, [null, null, null, null, null, null]);
  assert.equal(r.mibs4, null);
  assert.deepEqual(r.mibs4Answers, [null, null, null, null]);
});

test('"-日" は未入力(null)として扱う', () => {
  const text = FULL_SAMPLE
    .replace('頭痛があった日: 5日', '頭痛があった日: -日')
    .replace('痛み止め服用日: 3日', '痛み止め服用日: -日');
  const r = P.parseQrText(text);
  assert.equal(r.mhd, null);
  assert.equal(r.mmd, null);
  assert.equal(r.notClearDays, 4);
});

test('全角数字を正しく半角化して parse する', () => {
  const text = FULL_SAMPLE
    .replace('記入日: 2026/09/27', '記入日: ２０２６/０９/２７')
    .replace('頭痛があった日: 5日', '頭痛があった日: ５日')
    .replace('【HIT-6】 58点 かなり', '【HIT-6】 ５８点 かなり');
  const r = P.parseQrText(text);
  assert.equal(r.date, '2026/09/27');
  assert.equal(r.mhd, 5);
  assert.equal(r.hit6, 58);
});

test('備考の複数行を保持する', () => {
  const text = FULL_SAMPLE.replace(
    '【備考】 自由記述（任意、複数行あり得る）',
    '【備考】 1行目\n2行目\n3行目'
  );
  const r = P.parseQrText(text);
  assert.equal(r.note, '1行目\n2行目\n3行目');
});

test('旧形式の「日付:」ラベルにも対応する', () => {
  const text = FULL_SAMPLE.replace('記入日: 2026/09/27\n', '日付: 2026/09/27\n');
  const r = P.parseQrText(text);
  assert.equal(r.date, '2026/09/27');
});

test('記入日ラベルが「日付:」より優先される', () => {
  const text = '記入日: 2026/09/27\n日付: 2020/01/01\n' + FULL_SAMPLE;
  const r = P.parseQrText(text);
  assert.equal(r.date, '2026/09/27');
});

test('XSS文字列を escapeHtml で無害化する', () => {
  const xss = '<script>alert(1)</script>';
  const escaped = P.escapeHtml(xss);
  assert.equal(escaped.indexOf('<script>'), -1);
  assert.equal(escaped, '&lt;script&gt;alert(1)&lt;/script&gt;');

  const text = FULL_SAMPLE.replace('テスト 太郎', xss);
  const r = P.parseQrText(text);
  assert.equal(r.name, xss); // 生データは保持し、表示側でエスケープする
  assert.equal(P.escapeHtml(r.name).indexOf('<script>'), -1);
});

test('患者キー優先順位: 病院ID > 氏名+生年月日 > 氏名', () => {
  const withHid = P.parseQrText(FULL_SAMPLE);
  assert.equal(withHid.patientKey, 'hid:H-0001');

  const noHid = P.parseQrText(FULL_SAMPLE.replace('病院ID: H-0001', '病院ID: -'));
  assert.equal(noHid.patientKey, 'nb:テスト 太郎|1980/5/3');

  const noHidNoBday = P.parseQrText(
    FULL_SAMPLE.replace('病院ID: H-0001', '病院ID: -').replace('生年月日: 1980/5/3', '生年月日: -/-/-')
  );
  assert.equal(noHidNoBday.patientKey, 'n:テスト 太郎');
});

test('parseDateValue は生年月日行を扱わず、値なしは null', () => {
  assert.equal(P.parseDateValue('-'), null);
  assert.equal(P.parseDateValue('-/-/-'), null);
  assert.equal(P.parseDateValue('2026/9/27').iso, '2026/09/27');
});

test('migrateRecord は rawText から欠損フィールドを補完する', () => {
  const full = P.parseQrText(FULL_SAMPLE);
  const legacy = { id: 'legacy1', date: full.date, name: full.name, rawText: FULL_SAMPLE };
  const migrated = P.migrateRecord(legacy);
  assert.equal(migrated.hit6, 58);
  assert.equal(migrated.hospitalId, 'H-0001');
  assert.equal(migrated.patientKey, 'hid:H-0001');
  assert.equal(migrated.id, 'legacy1');
});

// ===== バージョン行（①②同一バージョン運用）=====
const VERSIONED_SAMPLE = FULL_SAMPLE.replace('頭痛チェックシート\n', '頭痛チェックシート\nバージョン: v1.2.0\n');

test('parseAppVersion: 版行ありなら v1.2.0 形式を返す', () => {
  assert.equal(P.parseAppVersion(VERSIONED_SAMPLE), 'v1.2.0');
});

test('parseAppVersion: 全角コロン・前後空白を許容する', () => {
  assert.equal(P.parseAppVersion('頭痛チェックシート\nバージョン：v1.2.0'), 'v1.2.0');
  assert.equal(P.parseAppVersion('頭痛チェックシート\n  バージョン :  v1.2.0  \n記入日: 2026/09/27'), 'v1.2.0');
  assert.equal(P.parseAppVersion('頭痛チェックシート\r\nバージョン: v1.2.0\r\n記入日: 2026/09/27'), 'v1.2.0');
});

test('parseAppVersion: 版行なし・不正形式は null', () => {
  assert.equal(P.parseAppVersion(FULL_SAMPLE), null);
  assert.equal(P.parseAppVersion(''), null);
  assert.equal(P.parseAppVersion(null), null);
  assert.equal(P.parseAppVersion('頭痛チェックシート\nバージョン: abc'), null);
  // 備考など行頭以外の「バージョン:」は拾わない
  assert.equal(P.parseAppVersion('頭痛チェックシート\n【備考】 バージョン: v1.2.0'), null);
});

test('parseAppVersion: 別版はそのまま返す（一致判定は呼び出し側）', () => {
  assert.equal(P.parseAppVersion('頭痛チェックシート\nバージョン: v1.1.1'), 'v1.1.1');
  assert.equal(P.parseAppVersion('頭痛チェックシート\nバージョン: v1.10.0'), 'v1.10.0');
});

test('版行入りテキストでも parseQrText の既存項目が従来どおり取れる', () => {
  const base = P.parseQrText(FULL_SAMPLE);
  const r = P.parseQrText(VERSIONED_SAMPLE);
  for (const k of Object.keys(base)) {
    if (k === 'rawText' || k === 'id') continue;
    assert.deepEqual(r[k], base[k], k);
  }
  assert.equal(r.date, '2026/09/27');
  assert.equal(r.name, 'テスト 太郎');
  assert.equal(r.patientKey, 'hid:H-0001');
  assert.deepEqual(r.hit6Answers, [1, 2, 3, 4, 5, 3]);
  assert.deepEqual(r.mibs4Answers, [1, 2, 3, 4]);
  // 版行が他フィールド（氏名・備考など）に混入しない
  assert.ok(!/バージョン/.test(r.note));
  assert.equal(r.doctor, 'テスト医師');
});

test('migrateRecord は版行なしの保存済みレコードを拒否せず補完できる', () => {
  const rec = { rawText: FULL_SAMPLE, date: '2026/09/27', sortKey: 20260927, patientKey: 'hid:H-0001' };
  const m = P.migrateRecord(rec);
  assert.equal(m.mhd, 5);
  assert.equal(m.date, '2026/09/27');
});

// ===== デモデータ =====
const DEMO_EXPECT = {
  months: ['2025/12/13', '2026/01/17', '2026/02/14', '2026/03/14', '2026/04/18', '2026/05/16', '2026/06/13', '2026/07/18', '2026/08/22', '2026/09/19'],
  mhd:  [16, 14, 15, 11, 12, 9, 7, 8, 5, 13],
  mmd:  [13, 12, 12, 9, 10, 7, 5, 6, 3, 11],
  hit6: [67, 64, 65, 59, 61, 56, 52, 54, 48, 63],
  mibs4: [10, 9, 9, 6, 7, 5, 3, 4, 2, 8]
};

test('buildDemoTexts: 10件・毎月1回（月が連続）・昇順・版行は引数どおり', () => {
  const texts = P.buildDemoTexts('v9.9.9');
  assert.equal(texts.length, 10);
  const recs = texts.map(t => P.parseQrText(t));
  assert.deepEqual(recs.map(r => r.date), DEMO_EXPECT.months);
  for (let i = 1; i < recs.length; i++) assert.ok(recs[i].sortKey > recs[i - 1].sortKey);
  // 各月 1 回で月が連続（2025/12 から 2026/09 まで）
  const ym = recs.map(r => { const [y, m] = r.date.split('/').map(Number); return y * 12 + m; });
  for (let i = 1; i < ym.length; i++) assert.equal(ym[i] - ym[i - 1], 1);
  // 日付は固定日ではなくばらつく
  assert.ok(new Set(recs.map(r => r.date.slice(8))).size >= 5);
  texts.forEach(t => assert.equal(P.parseAppVersion(t), 'v9.9.9'));
  assert.equal(P.parseAppVersion(P.buildDemoTexts('v1.3.0')[0]), 'v1.3.0');
});

test('buildDemoTexts: 経過は単調でなく、最終月は前月より悪化', () => {
  const recs = P.buildDemoTexts('v1.5.0').map(t => P.parseQrText(t));
  let ups = 0;
  for (let i = 1; i < recs.length; i++) if (recs[i].hit6 > recs[i - 1].hit6) ups++;
  assert.ok(ups >= 2, 'HIT-6 が前月より上がる月が2回以上ある');
  const last = recs[recs.length - 1], prev = recs[recs.length - 2];
  assert.ok(last.hit6 > prev.hit6);
  assert.ok(last.mibs4 > prev.mibs4);
  assert.ok(last.mhd > prev.mhd);
  assert.ok(recs[0].hit6 > prev.hit6, '全体としては初回より改善');
});

test('buildDemoTexts: 同一の架空患者（DEMO / デモ 患者 / 1985/4/1 / 女 / デモ）', () => {
  const recs = P.buildDemoTexts('v1.3.0').map(t => P.parseQrText(t));
  recs.forEach(r => {
    assert.equal(r.hospitalId, 'DEMO');
    assert.equal(r.name, 'デモ 患者');
    assert.equal(r.birthDate.display, '1985/4/1');
    assert.equal(r.sex, '女');
    assert.equal(r.doctor, 'デモ');
    assert.equal(r.patientKey, 'hid:DEMO');
  });
});

test('buildDemoTexts: HIT-6 / MIBS-4 / 頭痛日数 / 服薬日数が指定どおり', () => {
  const recs = P.buildDemoTexts('v1.3.0').map(t => P.parseQrText(t));
  assert.deepEqual(recs.map(r => r.mhd), DEMO_EXPECT.mhd);
  assert.deepEqual(recs.map(r => r.mmd), DEMO_EXPECT.mmd);
  assert.deepEqual(recs.map(r => r.hit6), DEMO_EXPECT.hit6);
  assert.deepEqual(recs.map(r => r.mibs4), DEMO_EXPECT.mibs4);
});

test('buildDemoTexts: 回答から再計算した点・判定が表示値と一致し、回答は範囲内', () => {
  P.buildDemoTexts('v1.3.0').map(t => P.parseQrText(t)).forEach(r => {
    assert.equal(r.hit6Answers.length, 6);
    assert.equal(r.mibs4Answers.length, 4);
    r.hit6Answers.forEach(a => assert.ok(Number.isInteger(a) && a >= 1 && a <= 5));
    r.mibs4Answers.forEach(a => assert.ok(Number.isInteger(a) && a >= 1 && a <= 6));
    const h = r.hit6Answers.reduce((s, a) => s + P.HIT6_PT[a - 1], 0);
    const m = r.mibs4Answers.reduce((s, a) => s + P.MIBS4_PT[a - 1], 0);
    assert.equal(h, r.hit6);
    assert.equal(m, r.mibs4);
    assert.equal(r.hit6Verdict, P.hit6Verdict(h));
    assert.equal(r.mibs4Verdict, P.mibs4Verdict(m));
  });
});

test('buildDemoTexts: 4つの日数の合計が28以下（スッキリせず/スッキリは自然な値）', () => {
  P.buildDemoTexts('v1.3.0').map(t => P.parseQrText(t)).forEach(r => {
    assert.ok(r.notClearDays >= 0 && r.clearDays >= 0);
    assert.ok(r.mhd + r.notClearDays + r.clearDays <= 28);
    assert.ok(r.mmd <= r.mhd);
  });
});

test('buildDemoRecords: 全件 isDemo: true で id が重複しない', () => {
  const recs = P.buildDemoRecords('v1.3.0');
  assert.equal(recs.length, 10);
  recs.forEach(r => assert.equal(r.isDemo, true));
  assert.equal(new Set(recs.map(r => r.id)).size, 10);
});

// ===== 記録の編集（applyRecordEdits / validateRecordEdits / findDuplicateRecord）=====
function sampleRec() {
  const r = P.parseQrText(FULL_SAMPLE);
  r.id = 'rec-1';
  r.registeredAt = '2026-09-27T01:00:00.000Z';
  r.fmExportedAt = '2026-09-27T02:00:00.000Z';
  return r;
}
const NOW = '2026-10-05T03:04:05.000Z';

test('applyRecordEdits: HIT-6 回答変更で点数・判定を再計算する', () => {
  const rec = sampleRec();
  const out = P.applyRecordEdits(rec, { hit6Answers: [1, 1, 1, 1, 1, 1] }, NOW);
  assert.deepEqual(out.hit6Answers, [1, 1, 1, 1, 1, 1]);
  assert.equal(out.hit6, 6 * 6);
  assert.equal(out.hit6Verdict, '影響なし');
  const hi = P.applyRecordEdits(rec, { hit6Answers: [5, 5, 5, 5, 5, 5] }, NOW);
  assert.equal(hi.hit6, 13 * 6);
  assert.equal(hi.hit6Verdict, '重度');
  assert.equal(rec.hit6, 58); // 元の rec は変更しない
});

test('applyRecordEdits: MIBS-4 回答変更で点数・判定を再計算する', () => {
  const out = P.applyRecordEdits(sampleRec(), { mibs4Answers: [5, 5, 6, 6] }, NOW);
  assert.equal(out.mibs4, 3 + 3 + 3 + 3);
  assert.equal(out.mibs4Verdict, '重度');
  const low = P.applyRecordEdits(sampleRec(), { mibs4Answers: [2, 2, 2, 2] }, NOW);
  assert.equal(low.mibs4, 0);
  assert.equal(low.mibs4Verdict, '支障なし');
});

test('applyRecordEdits: 未完（1問でも未回答）なら点数と判定は null', () => {
  const out = P.applyRecordEdits(sampleRec(), { hit6Answers: [1, 2, null, 4, 5, 3], mibs4Answers: [1, '', 3, 4] }, NOW);
  assert.equal(out.hit6, null);
  assert.equal(out.hit6Verdict, null);
  assert.deepEqual(out.hit6Answers, [1, 2, null, 4, 5, 3]);
  assert.equal(out.mibs4, null);
  assert.equal(out.mibs4Verdict, null);
  assert.deepEqual(out.mibs4Answers, [1, null, 3, 4]);
});

test('applyRecordEdits: 回答を渡さなければ点数・回答は変更されない', () => {
  const rec = sampleRec();
  const out = P.applyRecordEdits(rec, { note: '変更' }, NOW);
  assert.equal(out.hit6, 58);
  assert.deepEqual(out.hit6Answers, [1, 2, 3, 4, 5, 3]);
  assert.equal(out.mibs4, 4);
});

test('applyRecordEdits: 患者情報の変更で patientKey が変わる', () => {
  const rec = sampleRec();
  assert.equal(rec.patientKey, 'hid:H-0001');
  const a = P.applyRecordEdits(rec, { hospitalId: 'H-0002' }, NOW);
  assert.equal(a.patientKey, 'hid:H-0002');
  const b = P.applyRecordEdits(rec, { hospitalId: '', name: '変更 花子', birthDate: { y: '1990', m: '1', d: '2' } }, NOW);
  assert.equal(b.hospitalId, null);
  assert.equal(b.patientKey, 'nb:変更 花子|1990/1/2');
  assert.deepEqual(b.birthDate, { y: 1990, m: 1, d: 2, display: '1990/1/2' });
  const c = P.applyRecordEdits(rec, { hospitalId: '', birthDate: { y: '', m: '', d: '' } }, NOW);
  assert.equal(c.birthDate, null);
  assert.equal(c.patientKey, 'n:テスト 太郎');
});

test('applyRecordEdits: 記入日の変更で date / sortKey が更新される', () => {
  const out = P.applyRecordEdits(sampleRec(), { date: '2026-10-03' }, NOW);
  assert.equal(out.date, '2026/10/03');
  assert.equal(out.sortKey, 20261003);
  const out2 = P.applyRecordEdits(sampleRec(), { date: '2026/9/5' }, NOW);
  assert.equal(out2.date, '2026/09/05');
  assert.equal(out2.sortKey, 20260905);
});

test('applyRecordEdits: rawText は元のまま、editedAt を付与、id・registeredAt・isDemo は保持', () => {
  const rec = sampleRec();
  rec.isDemo = true;
  const out = P.applyRecordEdits(rec, { note: '', mhd: '7', hit6Answers: [1, 1, 1, 1, 1, 1] }, NOW);
  assert.equal(out.rawText, FULL_SAMPLE);
  assert.equal(out.editedAt, NOW);
  assert.equal(out.id, 'rec-1');
  assert.equal(out.registeredAt, '2026-09-27T01:00:00.000Z');
  assert.equal(out.isDemo, true);
  assert.equal(out.fmExportedAt, null); // 再書き出し対象に戻す
  assert.equal(rec.fmExportedAt, '2026-09-27T02:00:00.000Z'); // 元は変更しない
  assert.equal(out.mhd, 7);
  assert.equal(out.note, null);
  // editedAt を省略すると現在時刻（ISO）
  assert.match(P.applyRecordEdits(rec, {}).editedAt, /^\d{4}-\d{2}-\d{2}T/);
});

test('applyRecordEdits: 日数は空欄で null、0 は 0 のまま', () => {
  const out = P.applyRecordEdits(sampleRec(), { mhd: '0', mmd: '', notClearDays: ' ', clearDays: '28' }, NOW);
  assert.equal(out.mhd, 0);
  assert.equal(out.mmd, null);
  assert.equal(out.notClearDays, null);
  assert.equal(out.clearDays, 28);
});

test('applyRecordEdits: 不正な入力は Error（記入日空・実在しない日付・日数範囲外・回答範囲外）', () => {
  const rec = sampleRec();
  assert.throws(() => P.applyRecordEdits(rec, { date: '' }), /記入日は必須/);
  assert.throws(() => P.applyRecordEdits(rec, { date: '2026-02-31' }), /実在/);
  assert.throws(() => P.applyRecordEdits(rec, { date: '2026-13-01' }), /実在/);
  assert.throws(() => P.applyRecordEdits(rec, { mhd: '29' }), /0〜28/);
  assert.throws(() => P.applyRecordEdits(rec, { mmd: '-1' }), /0〜28/);
  assert.throws(() => P.applyRecordEdits(rec, { clearDays: '1.5' }), /0〜28/);
  assert.throws(() => P.applyRecordEdits(rec, { hit6Answers: [1, 2, 3, 4, 5, 6] }), /不正/);
  assert.throws(() => P.applyRecordEdits(rec, { mibs4Answers: [1, 2, 3] }), /4問/);
  assert.throws(() => P.applyRecordEdits(rec, { birthDate: { y: '1990', m: '2', d: '30' } }), /実在/);
});

test('validateRecordEdits: 3つの日数の合計が28超なら警告（エラーではない）。服薬日は含めない', () => {
  const rec = sampleRec();
  const over = P.validateRecordEdits(rec, { mhd: '15', notClearDays: '10', clearDays: '10' });
  assert.deepEqual(over.errors, []);
  assert.equal(over.warnings.length, 1);
  const ok = P.validateRecordEdits(rec, { mhd: '10', mmd: '28', notClearDays: '9', clearDays: '9' });
  assert.deepEqual(ok.errors, []);
  assert.deepEqual(ok.warnings, []);
  const bad = P.validateRecordEdits(rec, { date: '', mhd: '99' });
  assert.equal(bad.errors.length, 2);
});

test('findDuplicateRecord: 別 id で患者キー+記入日が一致するものだけ重複', () => {
  const a = Object.assign(sampleRec(), { id: 'a' });
  const b = Object.assign(sampleRec(), { id: 'b', date: '2026/10/27' });
  const edited = P.applyRecordEdits(b, { date: '2026-09-27' }, NOW);
  assert.equal(P.findDuplicateRecord([a, b], edited).id, 'a');
  // 自分自身（同 id）は重複ではない
  assert.equal(P.findDuplicateRecord([a, b], P.applyRecordEdits(b, { note: 'x' }, NOW)), undefined);
  // 別患者なら重複でない
  const other = P.applyRecordEdits(b, { date: '2026-09-27', hospitalId: 'H-9' }, NOW);
  assert.equal(P.findDuplicateRecord([a, b], other), undefined);
});

test('migrateRecord: editedAt 付きの記録は空にした値を rawText から復活させない', () => {
  const rec = sampleRec();
  const edited = P.applyRecordEdits(rec, { note: '', hospitalId: '', doctor: '', mhd: '', hit6Answers: [null, null, null, null, null, null] }, NOW);
  const m = P.migrateRecord(JSON.parse(JSON.stringify(edited))); // 保存→読み込み相当
  assert.equal(m.note, null);
  assert.equal(m.hospitalId, null);
  assert.equal(m.doctor, null);
  assert.equal(m.mhd, null);
  assert.equal(m.hit6, null);
  assert.equal(m.hit6Verdict, null);
  assert.equal(m.rawText, FULL_SAMPLE);
  assert.equal(m.editedAt, NOW);
  // 比較: editedAt なしなら従来どおり補完される
  const legacy = Object.assign({}, edited);
  delete legacy.editedAt;
  assert.equal(P.migrateRecord(legacy).note, '自由記述（任意、複数行あり得る）');
});
