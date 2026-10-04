/*
 * parser.js — 頭痛チェック QR テキストの parse・患者キー・日付処理・エスケープの純関数群。
 *
 * ブラウザでは <script src="parser.js"></script> で読み込みグローバルに公開する。
 * Node では module.exports で読み込み、`node --test test/` から呼ぶ。
 *
 * ①(Headache-Yes-No)の buildQrText() が出力するテキスト形式に対応する。
 * 参照した buildQrText の出力例:
 *   頭痛チェックシート
 *   バージョン: v1.2.0     (①②は同一バージョンで揃える。②は不一致の QR を登録しない)
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

  // "バージョン: v1.2.0"（全角コロン・前後空白可）の行から版文字列を返す。無ければ null。
  // ①(Headache-Yes-No)と②(本アプリ)は同一バージョンでないと登録できない運用のための判定用。
  function parseAppVersion(text) {
    var m = normalizeText(text).match(/^[ \t　]*バージョン[ \t　]*[:：][ \t　]*(v\d+(?:\.\d+)*)[ \t　]*$/m);
    return m ? m[1] : null;
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
    // 編集済み(editedAt あり)の記録は補完しない。編集で意図的に空にした値が rawText から復活するのを防ぐ。
    if (rec.rawText && !rec.editedAt) {
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

  // ===== 記録の編集（詳細画面からの手修正） =====
  // 実在する日付か（1900〜2100年）。
  function isRealDate(y, m, d) {
    if (!(y >= 1900 && y <= 2100 && m >= 1 && m <= 12 && d >= 1)) return false;
    var dt = new Date(Date.UTC(y, m - 1, d));
    return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
  }

  // 整数 or 空(null)に正規化。{ v: 整数|null } または { bad: true }。
  function intOrNull(v) {
    if (v == null) return { v: null };
    if (typeof v === 'number') return Number.isInteger(v) ? { v: v } : { bad: true };
    var s = normalizeText(v).trim();
    if (s === '' || s === '-') return { v: null };
    if (!/^\d+$/.test(s)) return { bad: true };
    return { v: parseInt(s, 10) };
  }

  function cleanStr(v) {
    if (v == null) return null;
    var s = String(v).trim();
    return s === '' ? null : s;
  }

  var EDIT_DAY_FIELDS = [
    { key: 'mhd', label: '頭痛があった日' },
    { key: 'mmd', label: '痛み止め服用日' },
    { key: 'notClearDays', label: 'スッキリせず' },
    { key: 'clearDays', label: 'スッキリ' }
  ];

  // edits を検証・正規化する。edits に無い（undefined の）項目は rec の値のまま。
  // 返り値: { errors: [], warnings: [], value: {...} }。
  function normalizeEdits(rec, edits) {
    rec = rec || {};
    edits = edits || {};
    var errors = [], warnings = [], out = {};
    function has(k) { return edits[k] !== undefined; }

    ['name', 'sex', 'hospitalId', 'doctor'].forEach(function (k) {
      out[k] = has(k) ? cleanStr(edits[k]) : (rec[k] == null ? null : rec[k]);
    });

    // 記入日（必須・実在日付）
    if (has('date')) {
      var ds = edits.date == null ? '' : normalizeText(edits.date).trim();
      var dm = ds.match(/^(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})$/);
      if (!ds) errors.push('記入日は必須です');
      else if (!dm || !isRealDate(parseInt(dm[1], 10), parseInt(dm[2], 10), parseInt(dm[3], 10))) errors.push('記入日が実在する日付ではありません');
      else {
        var y = parseInt(dm[1], 10), mo = parseInt(dm[2], 10), da = parseInt(dm[3], 10);
        out.dateObj = { y: y, m: mo, d: da, iso: y + '/' + String(mo).padStart(2, '0') + '/' + String(da).padStart(2, '0'), sortKey: y * 10000 + mo * 100 + da };
      }
    } else {
      var pv = parseDateValue(rec.date);
      if (pv) out.dateObj = pv; else errors.push('記入日は必須です');
    }

    // 生年月日（y/m/d の一部だけでも可。全部空なら null）
    if (has('birthDate')) {
      var b = edits.birthDate;
      if (b == null) out.birthDate = null;
      else {
        var by = intOrNull(b.y), bm = intOrNull(b.m), bd = intOrNull(b.d);
        if (by.bad || bm.bad || bd.bad) errors.push('生年月日は数字で入力してください');
        else if (by.v != null && (by.v < 1900 || by.v > 2100)) errors.push('生年月日の年は1900〜2100で入力してください');
        else if (bm.v != null && (bm.v < 1 || bm.v > 12)) errors.push('生年月日の月は1〜12で入力してください');
        else if (bd.v != null && (bd.v < 1 || bd.v > 31)) errors.push('生年月日の日は1〜31で入力してください');
        else if (by.v != null && bm.v != null && bd.v != null && !isRealDate(by.v, bm.v, bd.v)) errors.push('生年月日が実在する日付ではありません');
        else if (by.v == null && bm.v == null && bd.v == null) out.birthDate = null;
        else out.birthDate = {
          y: by.v, m: bm.v, d: bd.v,
          display: (by.v != null ? by.v : '-') + '/' + (bm.v != null ? bm.v : '-') + '/' + (bd.v != null ? bd.v : '-')
        };
      }
    } else {
      out.birthDate = rec.birthDate == null ? null : rec.birthDate;
    }

    // 日数 0〜28
    EDIT_DAY_FIELDS.forEach(function (f) {
      if (!has(f.key)) { out[f.key] = rec[f.key] == null ? null : rec[f.key]; return; }
      var r = intOrNull(edits[f.key]);
      if (r.bad || (r.v != null && (r.v < 0 || r.v > 28))) errors.push(f.label + 'は0〜28の整数で入力してください');
      else out[f.key] = r.v;
    });
    // 合計の警告。服薬日は頭痛日の部分集合なので含めない（一覧の警告マークと同じ基準）。
    var sum = (out.mhd || 0) + (out.notClearDays || 0) + (out.clearDays || 0);
    if (sum > 28) warnings.push('頭痛があった日・スッキリせず・スッキリの合計が' + sum + '日で、28日を超えています');

    // 回答（未回答 null 可。undefined なら変更しない）
    function normAnswers(key, label, n, max) {
      if (!has(key)) return undefined;
      var arr = edits[key];
      if (!Array.isArray(arr) || arr.length !== n) { errors.push(label + 'の回答は' + n + '問分が必要です'); return undefined; }
      var res = [];
      for (var i = 0; i < n; i++) {
        var r = intOrNull(arr[i]);
        if (r.bad || (r.v != null && (r.v < 1 || r.v > max))) { errors.push(label + ' 問' + (i + 1) + 'の回答が不正です'); return undefined; }
        res.push(r.v);
      }
      return res;
    }
    out.hit6Answers = normAnswers('hit6Answers', 'HIT-6', 6, 5);
    out.mibs4Answers = normAnswers('mibs4Answers', 'MIBS-4', 4, 6);

    // 備考
    if (has('note')) {
      var nt = edits.note == null ? '' : String(edits.note).replace(/\r\n?/g, '\n').trim();
      out.note = nt === '' ? null : nt;
    } else {
      out.note = rec.note == null ? null : rec.note;
    }

    return { errors: errors, warnings: warnings, value: out };
  }

  // 編集内容の検証。{ errors, warnings }（warnings は確認ダイアログ向け）。
  function validateRecordEdits(rec, edits) {
    var n = normalizeEdits(rec, edits);
    return { errors: n.errors, warnings: n.warnings };
  }

  // 編集を適用した新しいレコードを返す（元の rec は変更しない）。不正な edits は Error を投げる。
  // - HIT-6 / MIBS-4 は回答から再計算。全問回答時のみ点数と判定、未完は null。
  // - patientKey / date / sortKey を再計算。rawText は元のまま（証跡）。editedAt を付与。
  // - fmExportedAt を null に戻す（FileMaker へ再書き出し対象にする）。isDemo などその他は保持。
  function applyRecordEdits(rec, edits, nowIso) {
    var n = normalizeEdits(rec, edits);
    if (n.errors.length) throw new Error(n.errors.join(' / '));
    var v = n.value;
    var out = {};
    for (var k in rec) out[k] = rec[k];

    out.name = v.name; out.sex = v.sex; out.hospitalId = v.hospitalId; out.doctor = v.doctor;
    out.birthDate = v.birthDate;
    out.date = v.dateObj.iso;
    out.sortKey = v.dateObj.sortKey;
    out.mhd = v.mhd; out.mmd = v.mmd; out.notClearDays = v.notClearDays; out.clearDays = v.clearDays;
    out.note = v.note;

    if (v.hit6Answers !== undefined) {
      out.hit6Answers = v.hit6Answers;
      var h6done = v.hit6Answers.every(function (a) { return a != null; });
      out.hit6 = h6done ? sumPoints(v.hit6Answers, HIT6_PT) : null;
      out.hit6Verdict = h6done ? hit6Verdict(out.hit6) : null;
    }
    if (v.mibs4Answers !== undefined) {
      out.mibs4Answers = v.mibs4Answers;
      var m4done = v.mibs4Answers.every(function (a) { return a != null; });
      out.mibs4 = m4done ? sumPoints(v.mibs4Answers, MIBS4_PT) : null;
      out.mibs4Verdict = m4done ? mibs4Verdict(out.mibs4) : null;
    }

    out.patientKey = patientKey(out);
    out.editedAt = nowIso || new Date().toISOString();
    out.fmExportedAt = null;
    return out;
  }

  // 同じ患者キー+記入日の「別 id」の記録を返す（無ければ undefined）。編集後の重複判定用。
  function findDuplicateRecord(records, rec) {
    return (records || []).find(function (r) {
      return r && r.id !== rec.id && r.patientKey === rec.patientKey && r.date === rec.date;
    });
  }

  // ===== デモデータ（架空・固定） =====
  // 病院ID DEMO の架空患者。毎月1回来院（日付は実際の外来らしくばらつく）2025/12/13〜2026/09/19 の10回分。
  // 一直線ではなく、全体は改善傾向だが山あり谷あり（2月・4月・7月に一時悪化）で、最後の回で大きく悪化する。
  // 回答は HIT6_PT / MIBS4_PT で合計が点数になる組。4つの日数の合計は28以下（記入漏れ日があるのが自然）。
  var DEMO_HOSPITAL_ID = 'DEMO';
  var DEMO_ROWS = [
    { date: '2025/12/13', mhd: 16, mmd: 13, nc: 7, clear: 4, hit: [4, 4, 5, 4, 4, 3], mibs: [5, 6, 4, 4], note: '初診。市販薬を週3回以上使用。' },
    { date: '2026/01/17', mhd: 14, mmd: 12, nc: 8, clear: 4, hit: [4, 3, 4, 4, 3, 4], mibs: [5, 4, 5, 3], note: '' },
    { date: '2026/02/14', mhd: 15, mmd: 12, nc: 6, clear: 6, hit: [4, 3, 5, 4, 3, 3], mibs: [5, 5, 4, 3], note: '寒い日に頭痛が増えた。' },
    { date: '2026/03/14', mhd: 11, mmd: 9, nc: 5, clear: 10, hit: [2, 3, 4, 3, 3, 3], mibs: [4, 3, 5, 2], note: '予防薬を開始。' },
    { date: '2026/04/18', mhd: 12, mmd: 10, nc: 6, clear: 9, hit: [3, 3, 5, 3, 3, 2], mibs: [5, 3, 4, 3], note: '' },
    { date: '2026/05/16', mhd: 9, mmd: 7, nc: 4, clear: 13, hit: [3, 2, 3, 3, 3, 2], mibs: [4, 3, 4, 2], note: '' },
    { date: '2026/06/13', mhd: 7, mmd: 5, nc: 3, clear: 17, hit: [2, 2, 3, 2, 3, 2], mibs: [4, 2, 3, 2], note: '' },
    { date: '2026/07/18', mhd: 8, mmd: 6, nc: 4, clear: 14, hit: [2, 2, 3, 3, 3, 2], mibs: [4, 3, 3, 2], note: '梅雨時に少し悪化。' },
    { date: '2026/08/22', mhd: 5, mmd: 3, nc: 2, clear: 21, hit: [2, 1, 3, 2, 2, 2], mibs: [3, 2, 3, 2], note: '' },
    { date: '2026/09/19', mhd: 13, mmd: 11, nc: 6, clear: 9, hit: [3, 3, 4, 4, 4, 3], mibs: [5, 3, 4, 4], note: '仕事が繁忙期で睡眠不足。' }
  ];

  function sumPoints(answers, table) {
    return answers.reduce(function (s, a) { return s + table[a - 1]; }, 0);
  }

  // ①(Headache-Yes-No)の buildQrText と同じ形式のQRテキストを10件、記入日の昇順で返す。
  // 頭痛+スッキリせず+スッキリは28以下。点数・判定は回答から計算する。
  function buildDemoTexts(appVersion) {
    return DEMO_ROWS.map(function (r) {
      var h = sumPoints(r.hit, HIT6_PT);
      var m = sumPoints(r.mibs, MIBS4_PT);
      var lines = [
        '頭痛チェックシート',
        'バージョン: ' + appVersion,
        '記入日: ' + r.date,
        '生年月日: 1985/4/1',
        '氏名: デモ 患者',
        '性別: 女',
        '病院ID: ' + DEMO_HOSPITAL_ID,
        '担当医: デモ',
        '【過去4週間】',
        '頭痛があった日: ' + r.mhd + '日',
        '痛み止め服用日: ' + r.mmd + '日',
        'スッキリせず: ' + r.nc + '日',
        'スッキリ: ' + r.clear + '日',
        '【HIT-6】 ' + h + '点 ' + hit6Verdict(h),
        '回答: ' + r.hit.join(','),
        '【MIBS-4】 ' + m + '点 ' + mibs4Verdict(m),
        '回答: ' + r.mibs.join(',')
      ];
      if (r.note) lines.push('【備考】 ' + r.note);
      return lines.join('\n');
    });
  }

  // デモ記録（実データと同じ parseQrText 経路。isDemo: true を付ける）。
  function buildDemoRecords(appVersion, registeredAt) {
    var ts = registeredAt || new Date().toISOString();
    return buildDemoTexts(appVersion).map(function (t) {
      var rec = parseQrText(t);
      rec.isDemo = true;
      rec.registeredAt = ts;
      return rec;
    });
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

  // FileMaker へ渡してよい記録だけを返す。デモ記録(isDemo: true)は架空患者なので常に除外する。
  function fmExportable(records) {
    return (records || []).filter(function (r) { return r && !r.isDemo; });
  }

  // records の全件から新規にCSV(UTF-8, BOMなし, CRLF)を組み立てる。デモ記録は含めない。
  function buildFileMakerCsv(records) {
    var lines = [buildFileMakerHeaderLine()];
    fmExportable(records).forEach(function (r) { lines.push(buildFileMakerRow(r)); });
    return lines.join('\r\n') + '\r\n';
  }

  // 既存ファイル内容(existingText)の末尾に records を追記したCSV全文を返す。
  // existingTextが空ならヘッダーから新規作成する。
  function appendFileMakerCsv(existingText, records) {
    records = fmExportable(records);
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
    parseAppVersion: parseAppVersion,
    parseQrText: parseQrText,
    migrateRecord: migrateRecord,
    isRealDate: isRealDate,
    validateRecordEdits: validateRecordEdits,
    applyRecordEdits: applyRecordEdits,
    findDuplicateRecord: findDuplicateRecord,
    DEMO_HOSPITAL_ID: DEMO_HOSPITAL_ID,
    buildDemoTexts: buildDemoTexts,
    buildDemoRecords: buildDemoRecords,
    fmExportable: fmExportable,
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
