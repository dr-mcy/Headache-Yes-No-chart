const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../parser.js');

function baseRec(overrides) {
  return Object.assign({
    patientKey: 'hid:H-0001',
    date: '2026/09/27',
    hospitalId: 'H-0001',
    name: 'テスト 太郎',
    birthDate: { y: 1980, m: 5, d: 3, display: '1980/5/3' },
    sex: '男',
    doctor: 'テスト医師',
    mhd: 5, mmd: 3, notClearDays: 4, clearDays: 19,
    hit6: 58, hit6Verdict: 'かなり', hit6Answers: [1, 2, 3, 4, 5, 3],
    mibs4: 4, mibs4Verdict: '中等度', mibs4Answers: [1, 2, 3, 4],
    note: '備考1行目\n備考2行目',
    registeredAt: '2026-09-27T10:00:00.000Z'
  }, overrides);
}

test('ヘッダー列順が契約どおり', () => {
  const header = P.buildFileMakerHeaderLine();
  const expected = [
    '取込キー', '記入日', '病院ID', '氏名', '生年月日', '性別', '担当医',
    '頭痛日数', '服薬日数', 'スッキリせず日数', 'スッキリ日数',
    'HIT6合計', 'HIT6判定', 'HIT6_Q1', 'HIT6_Q2', 'HIT6_Q3', 'HIT6_Q4', 'HIT6_Q5', 'HIT6_Q6',
    'MIBS4合計', 'MIBS4判定', 'MIBS4_Q1', 'MIBS4_Q2', 'MIBS4_Q3', 'MIBS4_Q4',
    '備考', '登録日時', '契約版'
  ].map(h => `"${h}"`).join(',');
  assert.equal(header, expected);
});

test('取込キーは 患者キー + "|" + 記入日', () => {
  const rec = baseRec();
  assert.equal(P.fmImportKey(rec), 'hid:H-0001|2026/09/27');
});

test('1行の内容が契約どおり(引用符・列順・値)', () => {
  const csv = P.buildFileMakerCsv([baseRec()]);
  const lines = csv.split('\r\n');
  assert.equal(lines.length, 3); // header + 1 row + trailing empty
  assert.equal(lines[2], '');
  const cols = lines[1].split(',');
  assert.equal(cols[0], '"hid:H-0001|2026/09/27"');
  assert.equal(cols[1], '"2026/09/27"');
  assert.equal(cols[4], '"1980/05/03"');
  assert.equal(cols[11], '"58"');
  assert.equal(cols[19], '"4"');
  assert.equal(cols[27], '"1"'); // 契約版
});

test('CSVはCRLF区切りでBOMを含まない', () => {
  const csv = P.buildFileMakerCsv([baseRec()]);
  assert.equal(csv.charCodeAt(0), '"'.charCodeAt(0));
  assert.ok(csv.indexOf('\r\n') > 0);
  assert.ok(csv.indexOf('\n\n') < 0 || csv.indexOf('\r\n\r\n') >= 0); // no bare LF-only sequences beyond CRLF pairs
  assert.equal(csv.split('\r\n').join('').indexOf('\n'), -1);
});

test('備考の改行はリテラル\\nに置換される', () => {
  const csv = P.buildFileMakerCsv([baseRec()]);
  const row = csv.split('\r\n')[1];
  assert.ok(row.indexOf('備考1行目\\n備考2行目') >= 0);
});

test('フィールド内の二重引用符は二重化される', () => {
  const rec = baseRec({ name: 'テスト"太郎"', note: '"注意"あり' });
  const row = P.buildFileMakerRow(rec);
  assert.ok(row.indexOf('"テスト""太郎"""') >= 0);
  assert.ok(row.indexOf('"""注意""あり"') >= 0);
});

test('未回答・未入力は空欄', () => {
  const rec = baseRec({
    mhd: null, mmd: null, notClearDays: null, clearDays: null,
    hit6: null, hit6Verdict: null, hit6Answers: [null, null, null, null, null, null],
    mibs4: null, mibs4Verdict: null, mibs4Answers: [null, null, null, null],
    note: null, hospitalId: null, doctor: null, sex: null,
    birthDate: null
  });
  const cols = P.buildFileMakerRow(rec).split(',');
  assert.equal(cols[2], '""'); // 病院ID
  assert.equal(cols[4], '""'); // 生年月日
  assert.equal(cols[7], '""'); // 頭痛日数
  assert.equal(cols[13], '""'); // HIT6_Q1
  assert.equal(cols[25], '""'); // 備考
});

test('生年月日は一部でも未入力なら空欄("-/-/-"含む)', () => {
  const rec1 = baseRec({ birthDate: { y: 1980, m: null, d: 3, display: '1980/-/3' } });
  assert.equal(P.buildFileMakerRow(rec1).split(',')[4], '""');
  const rec2 = baseRec({ birthDate: null });
  assert.equal(P.buildFileMakerRow(rec2).split(',')[4], '""');
});

test('XSS文字列も生データのままCSVに出力される(CSVは実行されないため無害化不要)', () => {
  const rec = baseRec({ name: '<script>alert(1)</script>' });
  const row = P.buildFileMakerRow(rec);
  assert.ok(row.indexOf('<script>alert(1)</script>') >= 0);
});

test('appendFileMakerCsv: 既存が空なら新規作成', () => {
  const csv = P.appendFileMakerCsv('', [baseRec()]);
  assert.equal(csv, P.buildFileMakerCsv([baseRec()]));
});

test('appendFileMakerCsv: 既存内容の末尾に新規行だけを追記する', () => {
  const first = P.buildFileMakerCsv([baseRec()]);
  const second = baseRec({ date: '2026/10/01', patientKey: 'hid:H-0002', hospitalId: 'H-0002' });
  const appended = P.appendFileMakerCsv(first, [second]);
  const lines = appended.split('\r\n').filter(function (l) { return l !== ''; });
  assert.equal(lines.length, 3); // header + row1 + row2
  assert.ok(lines[2].indexOf('H-0002') >= 0);
});

test('appendFileMakerCsv: 追記対象が空なら既存内容をそのまま返す', () => {
  const first = P.buildFileMakerCsv([baseRec()]);
  assert.equal(P.appendFileMakerCsv(first, []), first);
});

// ===== デモ記録は FileMaker に出さない =====
test('fmExportable: isDemo の記録だけ除外する', () => {
  const real = baseRec();
  const demo = baseRec({ patientKey: 'hid:DEMO', isDemo: true });
  assert.deepEqual(P.fmExportable([real, demo]), [real]);
  assert.deepEqual(P.fmExportable(null), []);
});

test('buildFileMakerCsv: デモ記録は行に出ない（ヘッダー+実データのみ）', () => {
  const csv = P.buildFileMakerCsv([baseRec(), baseRec({ patientKey: 'hid:DEMO', hospitalId: 'DEMO', isDemo: true })]);
  assert.equal(csv.split('\r\n').length, 3);
  assert.ok(csv.indexOf('DEMO') < 0);
});

test('appendFileMakerCsv: デモ記録だけなら既存内容を変えず、新規でもヘッダーのみ', () => {
  const demo = baseRec({ hospitalId: 'DEMO', isDemo: true });
  const existing = P.buildFileMakerCsv([baseRec()]);
  assert.equal(P.appendFileMakerCsv(existing, [demo]), existing);
  assert.equal(P.appendFileMakerCsv('', [demo]), P.buildFileMakerCsv([]));
  const merged = P.appendFileMakerCsv(existing, [demo, baseRec({ date: '2026/10/01' })]);
  assert.equal(merged.split('\r\n').length, 4);
  assert.ok(merged.indexOf('DEMO') < 0);
});
