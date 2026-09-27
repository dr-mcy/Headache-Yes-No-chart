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
