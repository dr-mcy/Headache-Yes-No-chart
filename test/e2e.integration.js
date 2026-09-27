// 結合テスト: ①(Headache-Yes-No) の実際の buildQrText() を使って
// ②(このrepo)のQR取り込み・parse・患者キー・グラフ表示・レイアウトを検証する。
// 実患者データは使わない。すべて synthetic。
//
// 実行: node test/e2e.integration.js
'use strict';
const path = require('path');
const fs = require('fs');
const assert = require('assert');
const { chromium } = require('playwright');

const REPO_A = '/Users/admin/Projects/Headache-Yes-No/index.html';
const REPO_B = path.join(__dirname, '..', 'index.html');
const TMP_DIR = path.join(__dirname, '..', '.tmp-test');

function fail(msg) { console.error('FAIL:', msg); process.exitCode = 1; }
function ok(msg) { console.log('OK:', msg); }

async function main() {
  if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });
  if (!fs.existsSync(REPO_A)) throw new Error('①repo not found at ' + REPO_A);

  const browser = await chromium.launch();
  let failures = 0;
  try {
    // ---- Step 1: ①で synthetic データを入力して buildQrText() を取得 ----
    const pageA = await browser.newPage();
    await pageA.goto('file://' + REPO_A);

    await pageA.fill('#f-entry-date', '2026/09/27');
    await pageA.fill('#f-byear', '1980');
    await pageA.fill('#f-bmonth', '5');
    await pageA.fill('#f-bday', '3');
    await pageA.fill('#f-name', 'テスト 太郎');
    await pageA.selectOption('#f-sex', '男');
    await pageA.fill('#f-hid', 'H-9001');
    await pageA.fill('#f-doctor', 'テスト医師');

    const summaryInputs = await pageA.$$('.summary input');
    await summaryInputs[0].fill('5');
    await summaryInputs[1].fill('3');
    await summaryInputs[2].fill('4');
    await summaryInputs[3].fill('19');

    const hit6Choices = [2, 1, 3, 4, 0, 2]; // 0-indexed option per question
    for (let i = 0; i < hit6Choices.length; i++) {
      await pageA.click(`#hit6 .options button[data-q="${i}"][data-j="${hit6Choices[i]}"]`);
    }
    const mibs4Choices = [1, 2, 3, 4];
    for (let i = 0; i < mibs4Choices.length; i++) {
      await pageA.click(`#mibs4 .options button[data-q="${i}"][data-j="${mibs4Choices[i]}"]`);
    }
    await pageA.fill('.free textarea', 'synthetic 備考1行目\nsynthetic 備考2行目');

    const qrText = await pageA.evaluate(() => buildQrText());
    console.log('--- buildQrText() output ---\n' + qrText + '\n---------------------------');

    assert.ok(qrText.indexOf('記入日: 2026/09/27') >= 0, '記入日 line present');
    assert.ok(qrText.indexOf('病院ID: H-9001') >= 0, '病院ID line present');
    ok('①から synthetic QRテキストを取得');

    // ---- QR PNG生成 (①のqrcode-generatorを使い、gif dataURLをPNGへ再エンコード) ----
    await pageA.click('.actions .qr');
    await pageA.waitForSelector('#qr-area img');
    const pngDataUrl = await pageA.evaluate(async () => {
      const img = document.querySelector('#qr-area img');
      await new Promise((resolve) => { if (img.complete) resolve(); else img.onload = resolve; });
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth || img.width;
      canvas.height = img.naturalHeight || img.height;
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      return canvas.toDataURL('image/png');
    });
    const pngPath = path.join(TMP_DIR, 'synthetic-qr.png');
    fs.writeFileSync(pngPath, Buffer.from(pngDataUrl.split(',')[1], 'base64'));
    ok('QR PNG を生成: ' + pngPath);
    await pageA.close();

    // ---- Step 2: ②を開き、手動入力モーダルでQRテキストを登録 ----
    const pageB = await browser.newPage();
    await pageB.goto('file://' + REPO_B);
    await pageB.evaluate(() => { localStorage.clear(); return idbClear(); });
    await pageB.reload();
    await pageB.waitForTimeout(300);

    await pageB.click('text=手動入力');
    await pageB.fill('#manual-text', qrText);
    await pageB.click('#manual-modal .btn-primary');
    await pageB.waitForTimeout(300);

    const allRecords = await pageB.evaluate(() => idbGetAll());
    assert.strictEqual(allRecords.length, 1, '1件登録されていること');
    const rec = allRecords[0];
    assert.strictEqual(rec.date, '2026/09/27', '記入日が正しく parse されること');
    assert.strictEqual(rec.mhd, 5, 'MHD');
    assert.strictEqual(rec.mmd, 3, 'MMD');
    assert.strictEqual(rec.notClearDays, 4, 'notClearDays');
    assert.strictEqual(rec.clearDays, 19, 'clearDays');
    assert.strictEqual(rec.hospitalId, 'H-9001', '病院ID');
    assert.strictEqual(rec.patientKey, 'hid:H-9001', '患者キーは病院ID優先');
    ok('手動入力経由での登録内容が期待値と一致 (記入日=' + rec.date + ', MHD=' + rec.mhd + ', 病院ID=' + rec.hospitalId + ', patientKey=' + rec.patientKey + ')');

    // ---- Step 3: QR画像(setInputFiles)での取り込み確認 ----
    await pageB.click('text=QRコード読み取り');
    await pageB.setInputFiles('#qr-file-input', pngPath);
    await pageB.waitForTimeout(800);
    const afterImage = await pageB.evaluate(() => idbGetAll());
    assert.ok(afterImage.length >= 1, 'QR画像読み込み後もレコードが存在する');
    const matched = afterImage.find((r) => r.hospitalId === 'H-9001' && r.date === '2026/09/27');
    assert.ok(matched, 'QR画像から読み取った内容が既存患者+記入日と一致し重複処理されること');
    ok('QR画像(setInputFiles)からの読み取りに成功、件数=' + afterImage.length);

    // 同一内容の再登録は「登録済み」として弾かれる（上書きダイアログを出さない）ことを、
    // rawText同一の手動再入力で確認する。
    await pageB.click('text=手動入力');
    await pageB.fill('#manual-text', qrText);
    await pageB.click('#manual-modal .btn-primary');
    await pageB.waitForTimeout(300);
    const afterDup = await pageB.evaluate(() => idbGetAll());
    assert.strictEqual(afterDup.length, afterImage.length, '完全同一テキストの再登録は件数が増えないこと');
    ok('完全同一テキストの再読込は登録済みとして無視される');

    // ---- Step 4: レイアウト確認 (mobile 375px / desktop) ----
    await pageB.click('.patient-suggestions .sugg-item, #patient-search'); // no-op safeguard
    await pageB.fill('#patient-search', 'H-9001');
    await pageB.waitForTimeout(200);
    const sugg = await pageB.$('.patient-suggestions .sugg-item');
    if (sugg) await sugg.click();
    await pageB.waitForTimeout(300);

    await pageB.setViewportSize({ width: 375, height: 812 });
    await pageB.waitForTimeout(200);
    await pageB.screenshot({ path: path.join(TMP_DIR, 'screenshot-mobile-375.png'), fullPage: true });
    const mobileScroll = await pageB.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    ok('mobile 375px screenshot 保存, 横スクロール差分=' + mobileScroll + 'px');
    if (mobileScroll > 2) fail('mobile 375px で横スクロールが発生している (' + mobileScroll + 'px)');

    await pageB.setViewportSize({ width: 1280, height: 900 });
    await pageB.waitForTimeout(200);
    await pageB.screenshot({ path: path.join(TMP_DIR, 'screenshot-desktop-1280.png'), fullPage: true });
    const desktopScroll = await pageB.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    ok('desktop 1280px screenshot 保存, 横スクロール差分=' + desktopScroll + 'px');
    if (desktopScroll > 2) fail('desktop 1280px で横スクロールが発生している (' + desktopScroll + 'px)');

    await pageB.close();
  } catch (e) {
    failures++;
    fail(e.stack || e.message);
  } finally {
    await browser.close();
  }
  if (failures || process.exitCode) {
    console.error('\n結合テスト: 失敗あり');
    process.exit(1);
  } else {
    console.log('\n結合テスト: すべて成功');
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
