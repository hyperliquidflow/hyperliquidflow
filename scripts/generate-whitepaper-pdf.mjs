// scripts/generate-whitepaper-pdf.mjs
// Run: node scripts/generate-whitepaper-pdf.mjs
// Uses puppeteer-core + the cached chrome-headless-shell binary.
// printBackground: true is required — the --print-to-pdf CLI flag strips dark backgrounds.
import { fileURLToPath } from 'url';
import path from 'path';
import os from 'os';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const htmlPath = path.resolve(__dirname, '../docs/hyperliquidflow-whitepaper.html');
const pdfPath  = path.resolve(__dirname, '../docs/hyperliquidflow-whitepaper.pdf');

// Locate the cached chrome-headless-shell (installed by puppeteer, no re-download needed)
const chromePath = path.join(
  os.homedir(),
  '.cache/puppeteer/chrome-headless-shell/mac_arm-146.0.7680.153/chrome-headless-shell-mac-arm64/chrome-headless-shell'
);

const { default: puppeteer } = await import('puppeteer-core');

console.log('Launching browser...');
const browser = await puppeteer.launch({
  executablePath: chromePath,
  headless: true,
  args: ['--no-sandbox', '--disable-setuid-sandbox'],
});

const page = await browser.newPage();

// Load the HTML and wait for fonts
console.log('Loading HTML...');
await page.goto(`file://${htmlPath}`, { waitUntil: 'networkidle0', timeout: 30000 });

// Wait for Google Fonts to render
await page.evaluate(() => document.fonts.ready);
// Small buffer for any remaining layout
await new Promise(r => setTimeout(r, 800));

console.log('Generating PDF...');
await page.pdf({
  path: pdfPath,
  format: 'A4',
  printBackground: true,
  preferCSSPageSize: false,
  margin: { top: 0, right: 0, bottom: 0, left: 0 },
  displayHeaderFooter: false,
});

await browser.close();
console.log('Done:', pdfPath);
