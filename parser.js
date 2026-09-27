/*
 * parser.js — 頭痛チェック QR テキストの parse・患者キー・日付処理・エスケープの純関数群。
 *
 * ブラウザでは <script src="parser.js"></script> で読み込みグローバルに公開する。
 * Node では module.exports で読み込み、`node --test test/` から呼ぶ。
 *
 * ①(Headache-Yes-No)の buildQrText() が出力するテキスト形式に対応する。
 * 参照した buildQrText の出力例:
 *   頭痛チェックシート
 *   記入日: 2026/09/27
 *   生年月日: 1980/5/3
 *   氏名: ...
 *   性別: 男|女|-
 *   病院ID: ...
 *   担当医: ...
 *   【過去4週間】
 *   頭痛があった日: 5日
 *   痛み止め服用日: 3日
 *   スッキリせず: 4日
 *   スッキリ: 19日
 *   【HIT-6】 58点 かなり   (未回答は "未完")
 *   回答: 1,2,3,4,5,3       (未回答は "-")
 *   【MIBS-4】 4点 中等度
 *   回答: 1,2,3,4
 *   【備考】 自由記述（任意、複数行あり得る）
 */
(function (root) {
  'use strict';

  // ①(Headache-Yes-No/index.html)の設問文・選択肢ラベルをそのまま転記する。
  // 記録詳細画面で設問文に対応づけて回答を表示するために使う。
  var HIT6_Q = [
    { q: "頭が痛いとき、痛みがひどいことがどれくらいありますか?", opts: ["全くない", "ほとんどない", "時々ある", "しばしばある", "いつもそうだ"] },
    { q: "頭痛のせいで、日常生活に支障が出ることがありますか?", note: "(例えば、家事、仕事、学校生活、人付き合いなど)", opts: ["全くない", "ほとんどない", "時々ある", "しばしばある", "いつもそうだ"] },
    { q: "頭が痛いとき、横になりたくなることがありますか?", opts: ["全くない", "ほとんどない", "時々ある", "しばしばある", "いつもそうだ"] },
    { q: "この4週間に、頭痛のせいで疲れてしまって、仕事やいつもの活動ができないことがありましたか?", opts: ["全くなかった", "ほとんどなかった", "時々あった", "しばしばあった", "いつもそうだった"] },
    { q: "この4週間に、頭痛のせいで、うんざりしたりいらいらしたりしたことがありましたか?", opts: ["全くなかった", "ほとんどなかった", "時々あった", "しばしばあった", "いつもそうだった"] },
    { q: "この4週間に、頭痛のせいで、仕事や日常生活の場で集中できないことがありましたか?", opts: ["全くなかった", "ほとんどなかった", "時々あった", "しばしばあった", "いつもそうだった"] }
  ];
  var HIT6_PT = [6, 8, 10, 11, 13];

  var MIBS4_Q = [
    { q: "頭痛がない時に、頭痛は仕事又は学校に影響を与えた。" },
    { q: "頭痛が起こるかもしれないために、私は人付き合いやレジャー活動を計画することに不安を感じた。" },
    { q: "頭痛が起こっていない時に、頭痛は私の生活に影響を与えた。" },
    { q: "頭痛が起こっていない時に、私は頭痛のために無力感を覚えた。" }
  ];
  var MIBS4_OPTS = ["わからない／該当なし", "全くなかった", "ほとんどなかった", "時々", "多くの時間", "ほぼいつも／いつも"];
  var MIBS4_PT = [0, 0, 1, 2, 3, 3];

  function hit6Verdict(t) {
    if (t >= 60) return '重度';
    if (t >= 56) return 'かなり';
    if (t >= 50) return 'ある程度';
    return '影響なし';
  }
  function mibs4Verdict(t) {
    if (t >= 5) return '重度';
    if (t >= 3) return '中等度';
    if (t >= 1) return '軽度';
    return '支障なし';
  }

  // 全角数字 → 半角
  function normalizeText(text) {
    if (text == null) return '';
    return String(text).replace(/[０-９]/g, function (c) {
      return String.fromCharCode(c.charCodeAt(0) - 0xFEE0);
    });
  }

  function escapeHtml(str) {
    if (str == null) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // "5" / "-" / null 等 → 数値 or null
  function parseDaysValue(v) {
    if (v == null) return null;
    v = String(v).trim();
    if (v === '' || v === '-') return null;
    var n = parseInt(v, 10);
    return isNaN(n) ? null : n;
  }

  // "記入日: 2026/09/27" / "日付: 2026/09/27"（旧形式）のような、値部分の y/m/d を parse する。
  // "-" や "-/-/-" は未入力として null を返す。生年月日の行はここでは絶対に扱わない。
  function parseDateValue(raw) {
    if (raw == null) return null;
    var v = String(raw).trim();
    if (v === '' || v === '-') return null;
    var m = v.match(/^(\d{1,4})\s*[\/\-／年.]\s*(\d{1,2}|-)\s*[\/\-／月.]\s*(\d{1,2}|-)\s*日?$/);
    if (!m) return null;
    if (m[2] === '-' || m[3] === '-') return null;
    var y = parseInt(m[1], 10);
    var mo = parseInt(m[2], 10);
    var da = parseInt(m[3], 10);
    if (y < 100) y += 2000;
    if (!(y >= 1900 && y <= 2100 && mo >= 1 && mo <= 12 && da >= 1 && da <= 31)) return null;
    return {
      y: y, m: mo, d: da,
      iso: y + '/' + String(mo).padStart(2, '0') + '/' + String(da).padStart(2, '0'),
      sortKey: y * 10000 + mo * 100 + da
    };
  }

  // 記入日: / 日付:（旧形式） ラベル行だけから記入日を取る。生年月日行は絶対に見ない。
  function extractEntryDate(text) {
    var lines = text.split(/\r?\n/);
    for (var i = 0; i < lines.length; i++) {
      var m = lines[i].match(/^\s*記入日\s*[:：]\s*(.*)$/);
      if (m) return parseDateValue(m[1]);
    }
    for (var j = 0; j < lines.length; j++) {
      var m2 = lines[j].match(/^\s*日付\s*[:：]\s*(.*)$/);
      if (m2) return parseDateValue(m2[1]);
    }
    return null;
  }

  function extractLabel(text, label) {
    var re = new RegExp('^\\s*' + label + '\\s*[:：]\\s*(.*)$', 'm');
    var m = text.match(re);
    return m ? m[1].trim() : null;
  }

  // "1980/5/3" のような生年月日欄。未入力部分は "-"。全部 "-" なら null。
  function parseBirthDate(raw) {
    if (raw == null) return null;
    var v = String(raw).trim();
    var m = v.match(/^(\d{1,4}|-)\s*\/\s*(\d{1,2}|-)\s*\/\s*(\d{1,2}|-)$/);
    if (!m) return null;
    if (m[1] === '-' && m[2] === '-' && m[3] === '-') return null;
    var y = m[1] === '-' ? null : parseInt(m[1], 10);
    var mo = m[2] === '-' ? null : parseInt(m[2], 10);
    var da = m[3] === '-' ? null : parseInt(m[3], 10);
    if (y != null && y < 100) y += 2000;
    if (y == null && mo == null && da == null) return null;
    return {
      y: y, m: mo, d: da,
      display: (y != null ? y : '-') + '/' + (mo != null ? mo : '-') + '/' + (da != null ? da : '-')
    };
  }

  function parseAnswers(raw) {
    if (raw == null) return null;
    var parts = String(raw).split(',').map(function (s) { return s.trim(); });
    return parts.map(function (p) {
      if (p === '' || p === '-') return null;
      var n = parseInt(p, 10);
      return isNaN(n) ? null : n;
    });
  }

  function extractSection(text, label) {
    // 【HIT-6】 58点 かなり / 未完
    var re = new RegExp('【' + label + '】\\s*([^\\n]*)');
    var m = text.match(re);
    if (!m) return { done: false, score: null, verdict: null };
    var rest = m[1].trim();
    if (rest.indexOf('未完') >= 0) return { done: false, score: null, verdict: null };
    var sm = rest.match(/^(\d+)\s*点\s*(\S+)?/);
    if (!sm) return { done: false, score: null, verdict: null };
    return { done: true, score: parseInt(sm[1], 10), verdict: sm[2] || null };
  }

  function extractAnswersAfter(text, label) {
    var re = new RegExp('【' + label + '】[^\\n]*\\n回答\\s*[:：]\\s*([^\\n]*)');
    var m = text.match(re);
    if (!m) return null;
    return parseAnswers(m[1]);
  }

  function extractNote(text) {
    var m = text.match(/【備考】\s*([\s\S]*)$/);
    if (!m) return null;
    var v = m[1].replace(/\s+$/, '');
    return v === '' ? null : v;
  }

  // 患者キー: 病院ID があればそれ、無ければ 氏名+生年月日、それも無ければ氏名。
  function patientKey(rec) {
    var hid = rec.hospitalId && rec.hospitalId !== '-' ? rec.hospitalId.trim() : '';
    if (hid) return 'hid:' + hid;
    var name = rec.name && rec.name !== '-' ? rec.name.trim() : '';
    var bd = rec.birthDate && rec.birthDate.display && rec.birthDate.display !== '-/-/-' ? rec.birthDate.display : '';
    if (name && bd) return 'nb:' + name + '|' + bd;
    if (name) return 'n:' + name;
    return 'unknown:' + (rec.id || '');
  }

  function patientLabel(rec) {
    var hid = rec.hospitalId && rec.hospitalId !== '-' ? rec.hospitalId : '';
    var name = rec.name && rec.name !== '-' ? rec.name : '不明';
    var bd = rec.birthDate && rec.birthDate.display && rec.birthDate.display !== '-/-/-' ? rec.birthDate.display : '';
    var s = '';
    if (hid) s += hid + ' ';
    s += name;
    if (bd) s += '（' + bd + '）';
    return s;
  }

  function parseQrText(text) {
    var norm = normalizeText(text);
    var d = {};
    d.rawText = text;

    var entry = extractEntryDate(norm);
    if (entry) { d.date = entry.iso; d.sortKey = entry.sortKey; }
    else { d.date = null; d.sortKey = null; }

    var byRaw = extractLabel(norm, '生年月日');
    d.birthDate = parseBirthDate(byRaw);

    var name = extractLabel(norm, '氏名');
    d.name = (name && name !== '-') ? name : null;

    var sex = extractLabel(norm, '性別');
    d.sex = (sex && sex !== '-') ? sex : null;

    var hid = extractLabel(norm, '病院ID');
    d.hospitalId = (hid && hid !== '-') ? hid : null;

    var doctor = extractLabel(norm, '担当医');
    d.doctor = (doctor && doctor !== '-') ? doctor : null;

    d.mhd = parseDaysValue(extractLabel(norm, '頭痛があった日'));
    d.mmd = parseDaysValue(extractLabel(norm, '痛み止め服用日'));
    d.notClearDays = parseDaysValue(extractLabel(norm, 'スッキリせず'));
    d.clearDays = parseDaysValue(extractLabel(norm, 'スッキリ'));

    var hit6 = extractSection(norm, 'HIT-6');
    d.hit6 = hit6.done ? hit6.score : null;
    d.hit6Verdict = hit6.done ? hit6.verdict : null;
    d.hit6Answers = extractAnswersAfter(norm, 'HIT-6');

    var mibs4 = extractSection(norm, 'MIBS-4');
    d.mibs4 = mibs4.done ? mibs4.score : null;
    d.mibs4Verdict = mibs4.done ? mibs4.verdict : null;
    d.mibs4Answers = extractAnswersAfter(norm, 'MIBS-4');

    d.note = extractNote(norm);

    d.id = Date.now() + '_' + Math.random().toString(36).slice(2, 8);
    d.patientKey = patientKey(d);
    return d;
  }

  // 既存レコードに欠けているフィールドを rawText から再parseして補完する（後方互換）。
  function migrateRecord(rec) {
    if (!rec) return rec;
    var out = {};
    for (var k in rec) out[k] = rec[k];
    if (rec.rawText) {
      var reparsed = parseQrText(rec.rawText);
      for (var key in reparsed) {
        if (out[key] === undefined || out[key] === null) out[key] = reparsed[key];
      }
    }
    if (!out.id) out.id = Date.now() + '_' + Math.random().toString(36).slice(2, 8);
    if (!out.patientKey) out.patientKey = patientKey(out);
    if (out.sortKey == null && out.date) {
      var pv = parseDateValue(out.date);
      if (pv) out.sortKey = pv.sortKey;
    }
    return out;
  }

  // ===== FileMaker連携 CSV契約 v1 =====
  // 列順・書式は固定。変更する場合は契約バージョンを上げること。
  var FM_CONTRACT_VERSION = 1;
  var FM_HEADER = [
    '取込キー', '記入日', '病院ID', '氏名', '生年月日', '性別', '担当医',
    '頭痛日数', '服薬日数', 'スッキリせず日数', 'スッキリ日数',
    'HIT6合計', 'HIT6判定', 'HIT6_Q1', 'HIT6_Q2', 'HIT6_Q3', 'HIT6_Q4', 'HIT6_Q5', 'HIT6_Q6',
    'MIBS4合計', 'MIBS4判定', 'MIBS4_Q1', 'MIBS4_Q2', 'MIBS4_Q3', 'MIBS4_Q4',
    '備考', '登録日時', '契約版'
  ];

  function csvField(v) {
    if (v == null) v = '';
    return '"' + String(v).replace(/"/g, '""') + '"';
  }

  // 生年月日は y/m/d が全て揃っている場合のみ "YYYY/MM/DD" を出力し、
  // 一部でも未入力（"-/-/-" 等）なら空欄にする。
  function fmBirthDate(bd) {
    if (!bd || bd.y == null || bd.m == null || bd.d == null) return '';
    return bd.y + '/' + String(bd.m).padStart(2, '0') + '/' + String(bd.d).padStart(2, '0');
  }

  // 備考の改行はリテラル "\n"(2文字) に置換する。
  function fmNote(note) {
    if (!note) return '';
    return note.replace(/\r\n|\r|\n/g, '\\n');
  }

  function fmImportKey(rec) {
    return (rec.patientKey || '') + '|' + (rec.date || '');
  }

  function buildFileMakerRow(rec) {
    var hit6A = rec.hit6Answers || [];
    var mibs4A = rec.mibs4Answers || [];
    var fields = [
      fmImportKey(rec), rec.date || '', rec.hospitalId || '', rec.name || '', fmBirthDate(rec.birthDate), rec.sex || '', rec.doctor || '',
      rec.mhd != null ? rec.mhd : '', rec.mmd != null ? rec.mmd : '', rec.notClearDays != null ? rec.notClearDays : '', rec.clearDays != null ? rec.clearDays : '',
      rec.hit6 != null ? rec.hit6 : '', rec.hit6Verdict || '',
      hit6A[0] != null ? hit6A[0] : '', hit6A[1] != null ? hit6A[1] : '', hit6A[2] != null ? hit6A[2] : '', hit6A[3] != null ? hit6A[3] : '', hit6A[4] != null ? hit6A[4] : '', hit6A[5] != null ? hit6A[5] : '',
      rec.mibs4 != null ? rec.mibs4 : '', rec.mibs4Verdict || '',
      mibs4A[0] != null ? mibs4A[0] : '', mibs4A[1] != null ? mibs4A[1] : '', mibs4A[2] != null ? mibs4A[2] : '', mibs4A[3] != null ? mibs4A[3] : '',
      fmNote(rec.note), rec.registeredAt || '', FM_CONTRACT_VERSION
    ];
    return fields.map(csvField).join(',');
  }

  function buildFileMakerHeaderLine() {
    return FM_HEADER.map(csvField).join(',');
  }

  // records の全件から新規にCSV(UTF-8, BOMなし, CRLF)を組み立てる。
  function buildFileMakerCsv(records) {
    var lines = [buildFileMakerHeaderLine()];
    (records || []).forEach(function (r) { lines.push(buildFileMakerRow(r)); });
    return lines.join('\r\n') + '\r\n';
  }

  // 既存ファイル内容(existingText)の末尾に records を追記したCSV全文を返す。
  // existingTextが空ならヘッダーから新規作成する。
  function appendFileMakerCsv(existingText, records) {
    records = records || [];
    if (!existingText || !existingText.trim()) {
      return buildFileMakerCsv(records);
    }
    if (!records.length) return existingText;
    var trimmed = existingText.replace(/\r?\n$/, '');
    var newRows = records.map(buildFileMakerRow).join('\r\n');
    return trimmed + '\r\n' + newRows + '\r\n';
  }

  var api = {
    HIT6_Q: HIT6_Q,
    HIT6_PT: HIT6_PT,
    MIBS4_Q: MIBS4_Q,
    MIBS4_OPTS: MIBS4_OPTS,
    MIBS4_PT: MIBS4_PT,
    hit6Verdict: hit6Verdict,
    mibs4Verdict: mibs4Verdict,
    normalizeText: normalizeText,
    escapeHtml: escapeHtml,
    parseDaysValue: parseDaysValue,
    parseDateValue: parseDateValue,
    parseBirthDate: parseBirthDate,
    parseAnswers: parseAnswers,
    extractEntryDate: extractEntryDate,
    extractLabel: extractLabel,
    extractSection: extractSection,
    extractAnswersAfter: extractAnswersAfter,
    extractNote: extractNote,
    patientKey: patientKey,
    patientLabel: patientLabel,
    parseQrText: parseQrText,
    migrateRecord: migrateRecord,
    FM_CONTRACT_VERSION: FM_CONTRACT_VERSION,
    FM_HEADER: FM_HEADER,
    fmImportKey: fmImportKey,
    buildFileMakerRow: buildFileMakerRow,
    buildFileMakerHeaderLine: buildFileMakerHeaderLine,
    buildFileMakerCsv: buildFileMakerCsv,
    appendFileMakerCsv: appendFileMakerCsv
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.HeadacheParser = api;
  }
})(typeof window !== 'undefined' ? window : this);
