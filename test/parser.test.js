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
  months: ['2025/12/15', '2026/01/15', '2026/02/15', '2026/03/15', '2026/04/15', '2026/05/15', '2026/06/15', '2026/07/15', '2026/08/15', '2026/09/15'],
  mhd:  [15, 13, 12, 10, 9, 7, 6, 5, 4, 12],
  mmd:  [12, 11, 10, 8, 7, 6, 5, 4, 3, 10],
  hit6: [66, 64, 62, 60, 58, 55, 52, 50, 48, 62],
  mibs4: [9, 8, 7, 6, 5, 4, 3, 2, 2, 7]
};

test('buildDemoTexts: 10件・毎月15日・昇順・版行は引数どおり', () => {
  const texts = P.buildDemoTexts('v9.9.9');
  assert.equal(texts.length, 10);
  const recs = texts.map(t => P.parseQrText(t));
  assert.deepEqual(recs.map(r => r.date), DEMO_EXPECT.months);
  recs.forEach(r => assert.equal(r.date.slice(8), '15'));
  for (let i = 1; i < recs.length; i++) assert.ok(recs[i].sortKey > recs[i - 1].sortKey);
  texts.forEach(t => assert.equal(P.parseAppVersion(t), 'v9.9.9'));
  assert.equal(P.parseAppVersion(P.buildDemoTexts('v1.3.0')[0]), 'v1.3.0');
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
