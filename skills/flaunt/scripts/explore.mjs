#!/usr/bin/env node
// Look at a running app before planning: screenshot routes and list what is on them.
// Usage: node explore.mjs <shotlist.json> [/route ...] [--out dir]
//   Runs app.setup (unrecorded sign-in), visits each route at 1440x810, saves <out>/<route>.png and
//   prints headings, inputs, buttons and links with selectors, so you can pick shots and write steps.
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";
import { assertLocal, flag, loadShotlist } from "./lib.mjs";
import { makeRunner } from "./steps.mjs";

const args = process.argv.slice(2);
const { shotlist, dir } = loadShotlist(args[0], { requireShots: false });
const outDir = flag(args, "--out") ?? join(dir, "explore");
const baseUrl = shotlist.app?.url ?? "http://localhost:3000";
assertLocal(baseUrl);
const routes = args.slice(1).filter((a, i, all) => !a.startsWith("--") && all[i - 1] !== "--out");
const run = makeRunner(baseUrl);
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1440, height: 810 } })).newPage();
for (const step of shotlist.app?.setup ?? []) await run(page, step);

for (const r of routes.length ? routes : ["/"]) {
  await run(page, { goto: r });
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(800);
  const file = join(outDir, (r.replace(/[^\w]+/g, "_").replace(/^_|_$/g, "") || "home") + ".png");
  await page.screenshot({ path: file });
  const info = await page.evaluate(() => {
    const t = (e) => (e.innerText || e.value || e.placeholder || e.getAttribute("aria-label") || "").trim().replace(/\s+/g, " ").slice(0, 50);
    const pick = (sel, n) => [...document.querySelectorAll(sel)].filter((e) => e.getBoundingClientRect().width > 0).slice(0, n).map((e) => ({ tag: e.tagName.toLowerCase(), id: e.id || undefined, text: t(e), placeholder: e.placeholder || undefined, href: e.getAttribute("href") || undefined }));
    return {
      title: document.title,
      headings: pick("h1,h2,h3", 8),
      inputs: pick("input,textarea,select", 8),
      buttons: pick("button,[role=button]", 10),
      links: pick("a[href]", 12),
      scrollHeight: document.documentElement.scrollHeight,
      // bounding box of everything with visible text/images, as fractions of the viewport (for crop and viewport choices)
      contentBox: (() => {
        let x0 = 1e9, y0 = 1e9, x1 = 0, y1 = 0;
        for (const e of document.querySelectorAll("body *")) {
          const r = e.getBoundingClientRect();
          const hasText = [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
          if (r.width < 4 || r.height < 4 || !(hasText || e.tagName === "IMG" || e.tagName === "SVG" || e.tagName === "INPUT")) continue;
          x0 = Math.min(x0, r.left); y0 = Math.min(y0, r.top); x1 = Math.max(x1, r.right); y1 = Math.max(y1, r.bottom);
        }
        const W = innerWidth, H = innerHeight;
        return { x: +(x0 / W).toFixed(3), y: +(y0 / H).toFixed(3), w: +((x1 - x0) / W).toFixed(3), h: +((Math.min(y1, H) - y0) / H).toFixed(3) };
      })(),
    };
  });
  console.log(`\n== ${r}  ->  ${file}\n${JSON.stringify(info, null, 1)}`);
}
await browser.close();
