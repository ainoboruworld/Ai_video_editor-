#!/usr/bin/env node
/**
 * End-to-end smoke test of the core product flow, against a running app:
 *
 *   prompt → storyboard → assemble → edit → play → split → undo → export
 *
 * Playwright is not a project dependency (it would add ~100 MB to installs), so
 * install it on demand:
 *
 *   npm run build && npm start &
 *   npm i --no-save playwright && npx playwright install chromium
 *   node scripts/smoke-e2e.mjs [http://localhost:3000]
 *
 * Set PLAYWRIGHT_CHROMIUM to use an existing Chromium binary.
 */
import { statSync } from 'node:fs';

const base = process.argv[2] ?? 'http://localhost:3000';
const { chromium } = await import('playwright');

const log = (...args) => console.log('•', ...args);
const launchOptions = process.env.PLAYWRIGHT_CHROMIUM ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM } : {};

const browser = await chromium.launch(launchOptions);
const page = await browser.newPage({ viewport: { width: 1600, height: 950 } });
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));

try {
  await page.goto(base, { waitUntil: 'networkidle' });
  log('home:', await page.title());

  await page.fill('textarea', 'Create a 30-second Instagram Reel about organic mangoes');
  await page.click('button:has-text("Generate video")');
  await page.waitForURL(/\/projects\//, { timeout: 20_000 });
  await page.waitForSelector('canvas', { timeout: 20_000 });
  log('editor open');

  const storyboard = page.locator('div.z-40');
  const assemble = storyboard.getByRole('button', { name: 'Assemble on timeline' });
  await assemble.waitFor({ timeout: 60_000 });
  log('storyboard scenes:', await page.locator('article').count());

  await assemble.click();
  await page.waitForTimeout(800);
  await page.click('button[aria-label="Close storyboard"]');

  const clipCount = () => page.evaluate(() => document.querySelectorAll('[data-track-id] [role="button"]').length);
  log('clips after assemble:', await clipCount());

  await page.locator('nav button:has-text("Text")').click();
  await page.locator('button:has-text("Heading")').first().click();
  await page.waitForTimeout(600);
  log('clips after adding text:', await clipCount());

  await page.click('button[title="Play / pause (Space)"]');
  await page.waitForTimeout(1200);
  await page.click('button[title="Play / pause (Space)"]');

  await page.keyboard.press('s');
  await page.waitForTimeout(300);
  const split = await clipCount();
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(300);
  log('split → undo:', split, '→', await clipCount());

  await page.click('header button:has-text("Export")');
  await page.waitForSelector('text=In this browser');
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 240_000 }),
    page.click('button:has-text("Start export")'),
  ]);
  const file = await download.path();
  log('exported:', download.suggestedFilename(), statSync(file).size, 'bytes');

  if (errors.length > 0) {
    console.error('✗ page errors:', errors);
    process.exitCode = 1;
  } else {
    log('no page errors — flow OK');
  }
} catch (error) {
  console.error('✗ smoke test failed:', error.message);
  await page.screenshot({ path: 'smoke-failure.png' }).catch(() => {});
  process.exitCode = 1;
} finally {
  await browser.close();
}
