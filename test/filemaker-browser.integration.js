// FileMaker連携のブラウザ側動作確認（手動ダウンロード経路のみ）。
// showDirectoryPicker()によるフォルダ選択・書込・権限再取得は、ヘッドレスや自動テストから
// 実際のネイティブフォルダ選択ダイアログを操作できないため自動テスト不可。
// ここでは File System Access API 非対応環境向けの代替経路
// （「FileMaker用CSVを保存」による手動ダウンロード → 書き出し済みマーク）のみ検証する。
// 使用するデータは synthetic のみ（実患者データは使わない）。
'use strict';
const path = require('path');
const assert = require('assert');
const { chromium } = require('playwright');

const REPO_B = path.join(__dirname, '..', 'index.html');

function ok(msg) { console.log('OK:', msg); }

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto('file://' + REPO_B);
  await page.evaluate(() => { localStorage.clear(); return idbClear(); });
  await page.reload();
  await page.waitForTimeout(300);

  await page.evaluate(() => {
    var syntheticRecord = {
      id: 'fm1', rawText: 'synthetic', date: '2026/01/10', sortKey: 20260110,
      hospitalId: 'H-5001', name: 'synthetic-name', patientKey: 'hid:H-5001',
      hit6: 50, hit6Answers: [1, 1, 1, 1, 1, 1], mibs4: 2, mibs4Answers: [1, 1, 1, 1],
      note: null, registeredAt: new Date().toISOString()
    };
    return idbPutMany([syntheticRecord]).then(function () { return refreshAll(); });
  });

  const beforeCount = await page.evaluate(() => fmUnexportedRecords().length);
  assert.strictEqual(beforeCount, 1, '登録直後は未書き出し1件');
  ok('登録直後の未書き出し件数=1');

  page.once('dialog', (d) => d.accept());
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.evaluate(() => fmManualDownload())
  ]);
  assert.strictEqual(download.suggestedFilename(), 'headache_inbox.csv', 'ファイル名が契約どおり');
  const dlPath = path.join(__dirname, '..', '.tmp-test', 'headache_inbox_downloaded.csv');
  await download.saveAs(dlPath);
  const fs = require('fs');
  const csvText = fs.readFileSync(dlPath, 'utf8');
  assert.ok(csvText.startsWith('"取込キー"'), 'ヘッダーが契約どおり');
  assert.ok(csvText.indexOf('"hid:H-5001|2026/01/10"') >= 0, '取込キーの内容が一致');
  assert.ok(csvText.indexOf('\r\n') > 0, 'CRLF区切り');
  ok('手動ダウンロードのCSV内容を確認: ' + dlPath);

  await page.waitForTimeout(300); // confirm()のPromiseチェーン完了待ち
  const afterCount = await page.evaluate(() => fmUnexportedRecords().length);
  assert.strictEqual(afterCount, 0, '書き出し済みマーク後は未書き出し0件');
  ok('書き出し済みマーク後の未書き出し件数=0');

  await browser.close();
  console.log('\nFileMaker手動ダウンロード経路: すべて成功');
  console.log('注記: showDirectoryPicker()によるフォルダ自動書き出し(File System Access API)は');
  console.log('      ネイティブダイアログのため自動テストできません。未検証（手動確認が必要）。');
}

main().catch((e) => { console.error(e); process.exit(1); });
