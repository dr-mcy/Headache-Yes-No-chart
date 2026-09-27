// 性能計測: 1日約100名 x 数か月分を想定した synthetic 3,000件を IndexedDB に投入し、
// 起動(初期表示)・患者検索・グラフ描画にかかる時間を計測して報告する。
// 実患者データは使わない。
'use strict';
const path = require('path');
const { chromium } = require('playwright');

const REPO_B = path.join(__dirname, '..', 'index.html');
const N = 3000;
const PATIENTS = 800; // ユニーク患者数（複数回受診を想定）

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto('file://' + REPO_B);
  await page.evaluate(() => { localStorage.clear(); return idbClear(); });
  await page.reload();
  await page.waitForTimeout(300);

  const seedMs = await page.evaluate(async ({ n, patients }) => {
    function pad(v) { return String(v).padStart(2, '0'); }
    var records = [];
    var base = new Date(2026, 0, 1).getTime();
    for (var i = 0; i < n; i++) {
      var pIdx = i % patients;
      var d = new Date(base + i * 6 * 3600 * 1000);
      var y = d.getFullYear(), m = d.getMonth() + 1, day = d.getDate();
      var hit6 = 36 + (i % 43);
      var mibs4 = i % 13;
      records.push({
        id: 'perf_' + i,
        rawText: 'synthetic',
        date: y + '/' + pad(m) + '/' + pad(day),
        sortKey: y * 10000 + m * 100 + day,
        birthDate: { y: 1970 + (pIdx % 40), m: 1 + (pIdx % 12), d: 1 + (pIdx % 28), display: (1970 + (pIdx % 40)) + '/' + (1 + (pIdx % 12)) + '/' + (1 + (pIdx % 28)) },
        name: '患者' + pIdx,
        sex: (pIdx % 2 === 0) ? '男' : '女',
        hospitalId: 'H-' + String(10000 + pIdx),
        doctor: '医師' + (pIdx % 5),
        mhd: i % 29,
        mmd: i % 15,
        notClearDays: i % 10,
        clearDays: i % 20,
        hit6: hit6,
        hit6Verdict: hit6 >= 60 ? '重度' : hit6 >= 56 ? 'かなり' : hit6 >= 50 ? 'ある程度' : '影響なし',
        hit6Answers: [1, 2, 3, 4, 5, 3],
        mibs4: mibs4,
        mibs4Verdict: mibs4 >= 5 ? '重度' : mibs4 >= 3 ? '中等度' : mibs4 >= 1 ? '軽度' : '支障なし',
        mibs4Answers: [1, 2, 3, 4],
        note: null,
        patientKey: 'hid:H-' + String(10000 + pIdx)
      });
    }
    var t0 = performance.now();
    await idbPutMany(records);
    var t1 = performance.now();
    return t1 - t0;
  }, { n: N, patients: PATIENTS });

  console.log('投入(idbPutMany) ' + N + '件: ' + seedMs.toFixed(1) + ' ms');

  const t0 = Date.now();
  await page.reload();
  await page.waitForFunction(function () { return typeof window.__appLoadMs === 'number'; }, { timeout: 20000 });
  const startupMs = await page.evaluate(function () { return window.__appLoadMs; });
  console.log('起動〜初期表示（ページ読込直後の migrate+refreshAll, 実測）: ' + startupMs.toFixed(1) + ' ms (wall ' + (Date.now() - t0) + ' ms)');

  const searchMs = await page.evaluate(function () {
    document.getElementById('patient-search').value = 'H-100';
    var t0 = performance.now();
    onPatientSearchInput();
    var t1 = performance.now();
    return t1 - t0;
  });
  console.log('患者検索(部分一致フィルタ, ' + PATIENTS + '名インデックス): ' + searchMs.toFixed(1) + ' ms');

  const selectAndChartMs = await page.evaluate(function () {
    var box = document.getElementById('patient-suggestions');
    var item = box.querySelector('.sugg-item');
    var key = item ? item.getAttribute('data-key') : null;
    var t0 = performance.now();
    selectPatient(key);
    var t1 = performance.now();
    return { ms: t1 - t0, key: key, recCount: getFilteredData().length };
  });
  console.log('患者選択→グラフ再描画: ' + selectAndChartMs.ms.toFixed(1) + ' ms (patientKey=' + selectAndChartMs.key + ', 該当件数=' + selectAndChartMs.recCount + ')');

  const tableMs = await page.evaluate(function () {
    clearPatientSelection();
    var t0 = performance.now();
    toggleTable();
    var t1 = performance.now();
    return { ms: t1 - t0, rows: getFilteredData().length };
  });
  console.log('全レコード一覧テーブル描画(患者未選択, ' + tableMs.rows + '件): ' + tableMs.ms.toFixed(1) + ' ms');

  await browser.close();
  console.log('\n性能計測: 完了 (' + N + '件 / 患者' + PATIENTS + '名)');
}

main().catch(function (e) { console.error(e); process.exit(1); });
