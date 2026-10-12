#!/usr/bin/env node
// Convert an SVG logo to a transparent PNG (Playwright), ready for end.logo.
// Usage: node svg2png.mjs <in.svg> <out.png> [width=1200]
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "playwright";

const [inp, out, widthArg] = process.argv.slice(2);
if (!inp || !out) {
  console.error("usage: node svg2png.mjs <in.svg> <out.png> [width=1200]");
  process.exit(2);
}
const width = Number(widthArg ?? 1200);
const svg = readFileSync(resolve(inp), "utf8");
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width, height: 400 } });
await page.setContent(`<!doctype html><style>html,body{margin:0;background:transparent}svg{display:block;width:${width}px;height:auto}</style>${svg}`);
// trim empty padding: fit the viewBox to the drawn content so the logo centres properly on the end card
await page.evaluate(() => {
  const svg = document.querySelector("svg");
  const b = svg.getBBox();
  const pad = Math.max(b.width, b.height) * 0.01;
  svg.setAttribute("viewBox", `${b.x - pad} ${b.y - pad} ${b.width + 2 * pad} ${b.height + 2 * pad}`);
  svg.removeAttribute("height");
});
const box = await page.locator("svg").boundingBox();
await page.setViewportSize({ width, height: Math.ceil(box.height) });
await page.locator("svg").screenshot({ path: resolve(out), omitBackground: true });
await browser.close();
console.log(`wrote ${out} (${width}px wide, transparent)`);
