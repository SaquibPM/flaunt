#!/usr/bin/env node
// Sample a running app's real theme so the video matches it: background, text, accent, light/dark.
//
// Usage: node theme.mjs <shotlist.json> [/route ...]
//   Runs app.setup (unrecorded sign-in) from the shotlist, visits each route, and prints a
//   suggested "brand" block as JSON. Only local development URLs are allowed.
import { chromium } from "playwright";
import { assertLocal, loadShotlist } from "./lib.mjs";
import { makeRunner } from "./steps.mjs";

const args = process.argv.slice(2);
const { shotlist } = loadShotlist(args[0], { requireShots: false });
const baseUrl = shotlist.app?.url ?? "http://localhost:3000";
assertLocal(baseUrl);
const routes = args.slice(1).length ? args.slice(1) : ["/"];
const runStep = makeRunner(baseUrl);

const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
for (const step of shotlist.app?.setup ?? []) await runStep(page, step);

const samples = [];
for (const r of routes) {
  await runStep(page, { goto: r });
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(800);
  samples.push(
    await page.evaluate(() => {
      const parse = (c) => {
        const m = c.match(/rgba?\(([^)]+)\)/);
        if (!m) return null;
        const [r, g, b, a = 1] = m[1].split(/[ ,/]+/).filter(Boolean).map(Number);
        return { r, g, b, a };
      };
      const solid = (c) => c && c.a > 0.5;
      // page background: first solid background walking up from the main content area
      let el = document.querySelector("main") ?? document.body;
      let bg = null;
      while (el && !solid(bg)) { bg = parse(getComputedStyle(el).backgroundColor); el = el.parentElement; }
      if (!solid(bg)) bg = parse(getComputedStyle(document.documentElement).backgroundColor);
      if (!solid(bg)) bg = { r: 255, g: 255, b: 255, a: 1 };
      const heading = document.querySelector("h1,h2") ?? document.body;
      const text = parse(getComputedStyle(heading).color);
      // accent: the most saturated, visible solid background among buttons/links/badges (weighted by area)
      const sat = ({ r, g, b }) => { const mx = Math.max(r, g, b), mn = Math.min(r, g, b); return mx === 0 ? 0 : (mx - mn) / mx; };
      let best = null, bestScore = 0;
      for (const n of document.querySelectorAll("button,a,[role=button],[class*=primary],[class*=badge]")) {
        const c = parse(getComputedStyle(n).backgroundColor);
        const rect = n.getBoundingClientRect();
        if (!solid(c) || rect.width < 24 || rect.height < 16) continue;
        const score = (sat(c) + 0.05) * Math.sqrt(rect.width * rect.height);
        if (score > bestScore) { best = c; bestScore = score; }
      }
      // brand colour hints declared as CSS custom properties (--accent, --primary, --brand...)
      const vars = [];
      for (const sheet of document.styleSheets) {
        let rules; try { rules = sheet.cssRules; } catch { continue; }
        for (const r of rules ?? []) {
          if (!r.selectorText || !/^(:root|html|body)$/.test(r.selectorText.trim())) continue;
          for (const m of r.cssText.matchAll(/--([\w-]*(?:accent|primary|brand)[\w-]*)\s*:\s*(#[0-9a-fA-F]{3,8}|rgba?\([^)]*\)|hsla?\([^)]*\))/gi)) vars.push({ name: m[1], value: m[2] });
        }
      }
      // most saturated visible colour used on text, borders or backgrounds (weighted by area)
      let vivid = null, vividScore = 0;
      for (const n of document.querySelectorAll("body *")) {
        const rect = n.getBoundingClientRect();
        if (rect.width < 6 || rect.height < 6) continue;
        const cs = getComputedStyle(n);
        for (const key of ["color", "borderTopColor", "backgroundColor"]) {
          const c = parse(cs[key]);
          if (!c || c.a < 0.6) continue;
          const sc = sat(c) * Math.sqrt(rect.width * rect.height);
          if (sat(c) > 0.35 && sc > vividScore) { vivid = c; vividScore = sc; }
        }
      }
      // outer page background (what the app sits on): <body>, then <html>; falls back to the surface colour
      let stage = parse(getComputedStyle(document.body).backgroundColor);
      if (!solid(stage)) stage = parse(getComputedStyle(document.documentElement).backgroundColor);
      if (!solid(stage)) stage = bg;
      return { bg, stage, text, accent: best, vivid, vars };
    })
  );
}
await browser.close();

const hex = (c) => "#" + [c.r, c.g, c.b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");
const lum = (c) => (0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b) / 255;
// the most common background across routes wins
const bg = samples[0].bg;
const stage = samples[0].stage;
const text = samples[0].text ?? { r: 20, g: 20, b: 20 };
const dist = (a, b) => Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b);
// Declared brand colours: prefer names with "brand", then "primary", then "accent"; skip alert colours
// (danger/error/warning/red...) which are often called "accent" too.
const rank = (n) => (/brand/i.test(n) ? 0 : /primary/i.test(n) ? 1 : 2);
const declaredAll = [...new Map(samples.flatMap((s) => s.vars).filter((v) => !/danger|error|warn|critical|destructive|red|alert/i.test(v.name)).map((v) => [v.name, v])).values()].sort((a, b) => rank(a.name) - rank(b.name));
const declared = declaredAll[0];
// 6-digit alternative first: "#7c5cff" must not match as the 3-digit "#7c5"
const parsedVar = (v) => { if (!v) return null; const m = v.value.match(/^#([0-9a-f]{6}|[0-9a-f]{3})(?![0-9a-f])/i); if (!m) return null; const h = m[1].length === 3 ? m[1].replace(/./g, "$&$&") : m[1]; const n = parseInt(h, 16); return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 }; };
const candidates = [parsedVar(declared), ...samples.map((s) => s.accent), ...samples.map((s) => s.vivid)].filter(Boolean);
// first candidate that is clearly different from the text colour
const accent = candidates.find((c) => dist(c, text) > 90) ?? candidates[0] ?? text;
const mode = lum(bg) > 0.5 ? "light" : "dark";
// "bg" is the video stage: the colour users actually SEE as the app's background (its main surface),
// so the video feels like the product. "outerBackground" is the <body> colour behind it, if it differs.
const out = { mode, bg: hex(bg), outerBackground: hex(stage), text: hex(text), primary: hex(accent) };
if (declared) out.declaredAccent = `${declared.name}: ${declared.value}`;
if (declaredAll.length > 1) out.otherDeclared = declaredAll.slice(1, 6).map((v) => `${v.name}: ${v.value}`);
console.log(JSON.stringify(out, null, 2));
console.log(`\nSuggested "brand" (mode: ${mode}). "primary" is the brand accent (declared CSS variable, else the most prominent saturated colour). Check it against the logo; it must differ from the text colour so *highlighted* words stand out.`);
