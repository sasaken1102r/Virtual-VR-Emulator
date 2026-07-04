/**
 * README用スクリーンショットの自動撮影(Playwright、4言語分)。
 * 実行前提: tauri dev(ハブ)とSteamVRが起動中、vite devがlocalhost:1410。
 * 実行: リポジトリのどこからでも `node docs/tools/shoot_screens.mjs`
 * 出力: docs/images/{ja,en,zh,ko}/
 */
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const TOOLS_DIR = dirname(fileURLToPath(import.meta.url));
const IMAGES_DIR = join(TOOLS_DIR, '..', 'images');
// playwrightはapp/node_modulesから直接importする(このスクリプトの場所に依存しない)
const { chromium } = await import(
  new URL('../../app/node_modules/playwright/index.mjs', import.meta.url).href
);

const LANGS = ['ja', 'en', 'zh', 'ko'];

const browser = await chromium.launch();

for (const lang of LANGS) {
  const outDir = join(IMAGES_DIR, lang);
  mkdirSync(outDir, { recursive: true });

  const context = await browser.newContext({ viewport: { width: 1360, height: 880 } });
  // 言語を事前設定(localStorage経由。ブラウザ実行なので実アプリの設定には影響しない)
  await context.addInitScript((l) => {
    localStorage.setItem('vvre-settings', JSON.stringify({ language: l }));
  }, lang);
  const page = await context.newPage();

  await page.goto('http://localhost:1410');
  await page.waitForSelector('.status-dot.ok >> nth=1', { timeout: 15000 }).catch(() => {
    console.warn(`警告(${lang}): 接続ドットが緑になっていない`);
  });
  await page.waitForTimeout(2500);

  // 1. メイン画面
  await page.screenshot({ path: join(outDir, 'main.png') });

  // 2. FPSモードオーバーレイ(ポインタロックをスタブ)
  await page.evaluate(() => {
    document.querySelector('.viewport-wrap').requestPointerLock = () => {};
  });
  await page.locator('.fps-group button').first().click();
  await page.waitForSelector('.fps-overlay');
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(outDir, 'fps-mode.png') });
  await page.keyboard.press('Escape');

  // 3. 設定(キーバインド、Valve Index選択)
  await page.getByRole('button', { name: /⚙️/ }).click();
  await page.waitForSelector('.settings-window');
  await page.locator('.settings-nav-button').nth(1).click(); // キーバインドカテゴリ
  await page.locator('.bind-target-row select').selectOption('index');
  await page.waitForTimeout(300);
  await page.locator('.settings-window').screenshot({ path: join(outDir, 'settings-keybinds.png') });

  await context.close();
  console.log(`${lang} OK`);
}

await browser.close();
console.log('done');
