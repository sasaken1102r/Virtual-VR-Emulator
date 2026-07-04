/**
 * デモGIF用: アプリUIの動画をPlaywrightで録画しつつ、振り付け(demo_motion.mjs)を流す。
 * 実行: `node docs/tools/record_app.mjs [言語]` (言語: ja/en/zh/ko、省略時ja)
 * 出力: docs/tools/.rec/ にwebm (VRビュー側のフレームと合わせてffmpegでGIF化する)
 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const TOOLS_DIR = dirname(fileURLToPath(import.meta.url));
const REC_DIR = join(TOOLS_DIR, '.rec');
const lang = process.argv[2] ?? 'ja';

const { chromium } = await import(
  new URL('../../app/node_modules/playwright/index.mjs', import.meta.url).href
);

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 880, height: 660 },
  recordVideo: { dir: REC_DIR, size: { width: 880, height: 660 } },
});
await context.addInitScript((l) => {
  localStorage.setItem('vvre-settings', JSON.stringify({ language: l }));
}, lang);
const page = await context.newPage();
await page.goto('http://localhost:1410');
await page.waitForSelector('.status-dot.ok >> nth=1', { timeout: 15000 }).catch(() => {});
await page.waitForTimeout(2000);

// 振り付け開始(12秒)
console.log(`motion start (${lang})`);
const motion = spawn('node', [join(TOOLS_DIR, 'demo_motion.mjs'), 'loop', '12'], { stdio: 'inherit' });
await new Promise((resolve) => motion.on('exit', resolve));
await page.waitForTimeout(500);

await context.close(); // ここでwebmが確定する
await browser.close();
console.log('recorded');
