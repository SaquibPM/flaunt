#!/usr/bin/env node
// Cut recorded footage into a paced, beat-synced marketing video.
//
//   hook card -> framed product shots (sped up, kinetic captions) -> stat cards -> logo end card
//
// Usage: node compose.mjs <shotlist.json> [--silent] [--keep]
import { execFile, execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { chromium } from "playwright";
import { DEFAULT_SPEED, loadShotlist } from "./lib.mjs";
import { renderMusic, STYLES as MUSIC, writeWav } from "./music.mjs";

const run = promisify(execFile);
const t0 = Date.now();
const args = process.argv.slice(2);
const { shotlist, dir, shape } = loadShotlist(args[0]);
const silent = args.includes("--silent") || !shotlist.music;
const { w: W, h: H } = shape;
const fps = shotlist.render?.fps ?? 30;
const crf = String(shotlist.render?.crf ?? 20);
const shapeName = shotlist.shape ?? "wide";

const brand = {
  primary: "#5b5bf0",
  text: "#ffffff",
  bg: "#0b0b12",
  font: `"SF Pro Display", -apple-system, "Helvetica Neue", Inter, system-ui, sans-serif`,
  ...shotlist.brand,
};
const STYLES = {
  bold: { weight: 800, tracking: "-0.03em", mono: false, transitions: ["slideleft", "smoothleft", "wipeleft", "slideleft"] },
  calm: { weight: 600, tracking: "-0.015em", mono: false, transitions: ["fade", "smoothleft", "fade", "fadeblack"] },
  techy: { weight: 700, tracking: "-0.01em", mono: true, transitions: ["wipeleft", "slideleft", "wiperight", "slideright"] },
  warm: { weight: 700, tracking: "-0.02em", mono: false, transitions: ["smoothleft", "fade", "smoothright", "fade"] },
};
const style = STYLES[shotlist.style ?? "bold"] ?? STYLES.bold;
const lumOf = (hex) => { const n = parseInt(hex.replace("#", ""), 16); return (0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255; };
// light/dark follows the product's theme unless set explicitly in brand.mode
const light = (brand.mode ?? (lumOf(brand.bg) > 0.5 ? "light" : "dark")) === "light";
const font = style.mono ? `ui-monospace, "SF Mono", Menlo, monospace` : brand.font;

// ---------- helpers ----------
const even = (n) => Math.round(n / 2) * 2;
const esc = (s = "") => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const mk = (s) => esc(s).replace(/\*(.+?)\*/g, '<span class="hl">$1</span>'); // *word* -> accent colour
const rgba = (hex, a) => {
  const n = parseInt(hex.replace("#", ""), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
};
// cubic ease-out as an ffmpeg expression of time `t` after `start`, over `d` seconds
const E = (start, d) => `(1-pow(1-min(max((t-${start})/${d},0),1),3))`;

// ---------- timing: every cut lands on a beat ----------
const tone = shotlist.music?.tone ?? shotlist.style ?? "bold";
const bpm = silent ? 120 : (MUSIC[tone] ?? MUSIC.bold).bpm;
const beat = 60 / bpm;
const D = Math.min(0.3, beat / 2); // transition length
const beats = (sec, min = 3) => Math.max(min, Math.round(sec / beat));

// ---------- layout ----------
const vp = shotlist.record?.viewport ?? shape.viewport;
const srcAr = vp.width / vp.height;
const MARGIN = 0.07; // captions and the product window share this left/right margin
const capBand = { wide: 0.19, tall: 0.16, square: 0.21 }[shapeName];
const availH = H * (1 - capBand - 0.05);
const ww = even(W * (1 - 2 * MARGIN));
const wh = even(availH);
const winAr = ww / wh;
const wx = Math.round(W * MARGIN);
const wy = Math.round(H * capBand + (availH - wh) / 2);
const wcy = wy + wh / 2;
const R = Math.round(Math.min(W, H) * 0.024);
const big = Math.round(Math.min(W, H) * 0.076);

const work = join(dir, "work");
rmSync(work, { recursive: true, force: true });
mkdirSync(work, { recursive: true });
const P = (f) => join(work, f);

// ---------- logo + end card colours ----------
const end = { seconds: 3, ...shotlist.end };
const logo = end.logo ? resolve(dir, end.logo) : null;
let endBg = brand.bg;
let endGlow = true;
let endText = brand.text;
let logoAspect = 1;
let logoCrop = null; // {w,h,x,y} of the drawn area inside a padded transparent logo
if (logo && existsSync(logo)) {
  const px = execFileSync("ffmpeg", ["-v", "error", "-i", logo, "-vf", "crop=1:1:3:3,format=rgba", "-f", "rawvideo", "-"]);
  if (px[3] > 200) {
    // opaque logo background: match the end card to it so the logo sits seamlessly
    endBg = "#" + [px[0], px[1], px[2]].map((v) => v.toString(16).padStart(2, "0")).join("");
    endGlow = false;
    const lum = (0.2126 * px[0] + 0.7152 * px[1] + 0.0722 * px[2]) / 255;
    endText = lum > 0.6 ? (light ? brand.text : "#161a14") : "#f6f5ee";
  }
  let [lw, lh] = execFileSync("ffprobe", ["-v", "error", "-show_entries", "stream=width,height", "-of", "csv=p=0", logo], { encoding: "utf8" }).trim().split(",").map(Number);
  // transparent logos often carry padding (an SVG viewBox wider than its drawing): trim it so the logo is truly centred
  if (px[3] <= 200) {
    const probe = spawnSync("ffmpeg", ["-hide_banner", "-i", logo, "-vf", "format=rgba,alphaextract,cropdetect=limit=8:round=2:reset=0", "-f", "null", "-"], { encoding: "utf8" });
    const m = [...String(probe.stderr ?? "").matchAll(/crop=(\d+):(\d+):(\d+):(\d+)/g)].pop();
    if (m && +m[1] > 8 && +m[2] > 8) { logoCrop = { w: +m[1], h: +m[2], x: +m[3], y: +m[4] }; lw = logoCrop.w; lh = logoCrop.h; }
  }
  logoAspect = lw / lh;
} else if (end.logo) {
  console.warn(`logo not found: ${logo} — falling back to a text wordmark`);
}
const hasLogo = logo && existsSync(logo);

// ---------- graphics (rendered in the browser) ----------
const baseCss = `
  html,body{margin:0;width:${W}px;height:${H}px;overflow:hidden;background:transparent}
  *{box-sizing:border-box} body{font-family:${font};color:${brand.text};-webkit-font-smoothing:antialiased}
  .hl{color:${brand.primary}}
  .center{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center}`;
const stageCss = (bg, glow) => `
  body{background:${bg}}
  ${glow ? `body::after{content:"";position:absolute;inset:0;background-image:radial-gradient(circle at 1px 1px, ${light ? "rgba(30,35,25,.10)" : "rgba(255,255,255,.055)"} 1.3px, transparent 0);background-size:38px 38px}` : ""}
  ${glow && !light ? `body::before{content:"";position:absolute;inset:0;background:
    radial-gradient(60% 55% at 85% 0%, ${rgba(brand.primary, 0.28)}, transparent 70%),
    radial-gradient(55% 50% at 5% 100%, ${rgba(brand.primary, 0.2)}, transparent 70%)}` : ""}`;

const html = (css, body) => `<!doctype html><meta charset="utf-8"><style>${baseCss}${css}</style>${body}`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: W, height: H } });
const png = async (h, file, transparent = true, size) => {
  if (size) await page.setViewportSize(size);
  await page.setContent(h, { waitUntil: "load" });
  for (let attempt = 1; ; attempt++) {
    try { await page.screenshot({ path: file, omitBackground: transparent }); break; }
    catch (e) { if (attempt >= 3) throw e; await new Promise((r) => setTimeout(r, 1500)); } // transient Chromium failure on a starved machine
  }
  if (size) await page.setViewportSize({ width: W, height: H });
};

// stage: branded background with the product window's shadow and outline baked in
await png(
  html(
    stageCss(brand.bg, true),
    `<div style="position:absolute;left:${wx}px;top:${wy}px;width:${ww}px;height:${wh}px;border-radius:${R}px;background:${light ? "rgba(255,255,255,.5)" : "rgba(0,0,0,.25)"};
       box-shadow:0 ${Math.round(H * 0.035)}px ${Math.round(H * 0.08)}px ${light ? "rgba(40,45,30,.22)" : "rgba(0,0,0,.5)"}, 0 0 0 ${light ? "1.5px rgba(40,45,30,.14)" : `3px rgba(255,255,255,.2), 0 0 ${Math.round(H * 0.06)}px ${rgba(brand.primary, 0.3)}`}"></div>`
  ),
  P("stage.png"), false
);
await png(html(stageCss(brand.bg, true), ""), P("bare.png"), false);
await png(html(stageCss(endBg, endGlow), ""), P("endbg.png"), false);
await png(
  html(`body{background:#000}`, `<div style="width:${ww}px;height:${wh}px;border-radius:${R}px;background:#fff"></div>`),
  P("mask.png"), false, { width: ww, height: wh }
);

const captionPng = (n, text, file) =>
  png(
    html(
      `.wrap{position:absolute;left:${W * MARGIN}px;top:${H * 0.05}px;width:${W * (1 - 2 * MARGIN)}px}
       .chip{font:700 ${Math.round(big * 0.34)}px/1 ui-monospace,"SF Mono",Menlo,monospace;letter-spacing:.18em;color:${brand.primary};margin-bottom:${Math.round(big * 0.22)}px}
       .t{font-weight:${style.weight};font-size:${big}px;line-height:1.04;letter-spacing:${style.tracking}}`,
      `<div class="wrap"><div class="chip">${String(n).padStart(2, "0")}</div><div class="t">${mk(text)}</div></div>`
    ),
    file
  );

// A callout is a small pill pinned to the product window that names what is happening ("Agent answers with evidence").
const calloutPng = async (text, file) => {
  await page.setContent(
    html(
      `.w{position:absolute;left:20px;top:20px;padding:46px}
       .pill{display:inline-flex;align-items:center;gap:.6em;white-space:nowrap;font:700 ${Math.round(big * 0.3)}px/1 ${font};letter-spacing:-0.01em;
         color:${light ? brand.text : "#fff"};background:${light ? "#ffffff" : "rgba(22,26,32,.95)"};border:2px solid ${rgba(brand.primary, 0.55)};
         border-radius:999px;padding:.62em 1.1em .62em .9em;box-shadow:0 12px 32px rgba(0,0,0,${light ? 0.18 : 0.5})}
       .dot{width:.72em;height:.72em;border-radius:50%;background:${brand.primary};box-shadow:0 0 0 .32em ${rgba(brand.primary, 0.25)}}`,
      `<div class="w" id="w"><div class="pill"><span class="dot"></span><span>${mk(text)}</span></div></div>`
    ),
    { waitUntil: "load" }
  );
  await page.locator("#w").screenshot({ path: file, omitBackground: true });
};

const linePng = (text, i, n, file, { size = 1.85, color } = {}) => {
  const lh = big * size * 1.12;
  const top = H / 2 + (i - (n - 1) / 2) * lh - lh / 2;
  return png(
    html(
      `.l{position:absolute;left:0;right:0;top:${top}px;height:${lh}px;display:flex;align-items:center;justify-content:center;text-align:center;
         font-weight:${style.weight};font-size:${big * size}px;letter-spacing:${style.tracking};line-height:1;padding:0 ${W * 0.06}px;${color ? `color:${color}` : ""}}`,
      `<div class="l"><div>${mk(text)}</div></div>`
    ),
    file
  );
};

// ---------- build the scene list ----------
const footage = (id) => join(dir, "footage", `${id}.webm`);
const scenes = [];
if (shotlist.hook) scenes.push({ kind: "hook", n: beats(shotlist.hook.seconds ?? 2, 3), hook: shotlist.hook });
let shotNo = 0;
for (const s of shotlist.shots) {
  if (s.steps) scenes.push({ kind: "shot", n: beats(s.seconds, 3), shot: s, no: ++shotNo });
  else scenes.push({ kind: "stat", n: beats(s.seconds ?? 2, 3), stat: s });
}
scenes.push({ kind: "end", n: beats(end.seconds, 4) });
scenes.forEach((s, i) => { s.i = i; s.dur = s.n * beat + D; s.out = P(`seg${i}.mp4`); });
const projected = scenes.reduce((n, s) => n + s.n * beat, 0) + D;
if ((projected < 23 || projected > 40) && !args.includes("--allow-any-length")) {
  console.error(`flaunt: the cut would be ${projected.toFixed(1)} s. Videos must be 23-40 s. Add/remove shots or stats (about 3 s per shot, 2 s per stat), or pass --allow-any-length.`);
  process.exit(1);
}


// ---------- per-scene graphics ----------
for (const sc of scenes) {
  if (sc.kind === "shot") {
    await captionPng(sc.no, sc.shot.caption ?? "", P(`cap${sc.i}.png`));
    for (const [k, co] of (sc.shot.callouts ?? []).entries()) await calloutPng(co.text, P(`co${sc.i}-${k}.png`));
  }
  if (sc.kind === "hook") {
    const lines = sc.hook.lines;
    for (const [k, l] of lines.entries()) await linePng(l, k, lines.length, P(`hook${sc.i}-${k}.png`));
  }
  if (sc.kind === "stat") {
    // Numbers count up from zero: render one transparent frame per video frame, then hold the last.
    await page.setContent(html(
      `.v{font-weight:${style.weight};font-size:${Math.min(W, H) * 0.26}px;letter-spacing:-0.04em;line-height:1;color:${brand.primary};font-variant-numeric:tabular-nums}
       .s{margin-top:${H * 0.03}px;font-weight:600;font-size:${big * 0.7}px;max-width:${W * 0.92}px;line-height:1.2;opacity:.92}`,
      `<div class="center"><div class="v" id="v"></div><div class="s">${mk(sc.stat.label ?? "")}</div></div>`
    ), { waitUntil: "load" });
    const frames = Math.ceil(sc.dur * fps);
    const countFrames = Math.min(frames, Math.round(fps * 0.9));
    const startF = Math.round(fps * 0.1);
    const fmt = (p) => sc.stat.value.replace(/\d+(\.\d+)?/g, (m) => {
      const n = parseFloat(m) * (1 - (1 - p) ** 3);
      return Number.isInteger(parseFloat(m)) ? String(Math.round(n)) : n.toFixed(1);
    });
    for (let k = 0; k < frames; k++) {
      const file = P(`stat${sc.i}-${String(k).padStart(3, "0")}.png`);
      if (k <= startF + countFrames) {
        const p = sc.stat.count === false ? 1 : Math.min(1, Math.max(0, (k - startF) / countFrames));
        await page.evaluate(([t]) => { document.getElementById("v").textContent = t; }, [fmt(p)]);
        await page.screenshot({ path: file, omitBackground: true });
        sc.lastStat = file;
      } else {
        copyFileSync(sc.lastStat, file);
      }
    }
  }
  if (sc.kind === "end") {
    const below = H * 0.66;
    if (!hasLogo) {
      await png(html(`.w{font-weight:${style.weight};font-size:${Math.min(W, H) * 0.2}px;letter-spacing:-0.04em;color:${endText}}`, `<div class="center"><div class="w">${esc(shotlist.name ?? "")}</div></div>`), P("endlogo.png"));
    }
    if (end.tagline) {
      await png(html(`.t{position:absolute;left:0;right:0;top:${H * 0.6}px;text-align:center;font-weight:600;font-size:${big * 0.62}px;color:${endText};opacity:.9;letter-spacing:${style.tracking}}`, `<div class="t">${mk(end.tagline)}</div>`), P("endtag.png"));
    }
    if (end.line) {
      await png(
        html(
          `.u{position:absolute;left:0;right:0;top:${below + (end.tagline ? H * 0.06 : 0)}px;display:flex;justify-content:center}
           .u div{font-weight:600;font-size:${big * 0.5}px;color:${endText};padding:${big * 0.2}px ${big * 0.5}px;border:2px solid ${brand.primary};border-radius:999px;letter-spacing:.01em}`,
          `<div class="u"><div>${esc(end.line)}</div></div>`
        ),
        P("endurl.png")
      );
    }
  }
}
await browser.close();

// ---------- ffmpeg scene builders ----------
const loopIn = (file, dur) => ["-loop", "1", "-framerate", String(fps), "-t", dur.toFixed(3), "-i", file];
const encode = (dur, out) => ["-t", dur.toFixed(3), "-r", String(fps), "-c:v", "libx264", "-preset", "veryfast", "-crf", crf, "-pix_fmt", "yuv420p", "-an", out];

function shotArgs(sc) {
  const s = sc.shot;
  const clip = footage(s.id);
  if (!existsSync(clip)) throw new Error(`Missing footage for ${s.id}. Run record.mjs first.`);
  const meta = join(dir, "footage", `${s.id}.json`);
  const metaData = existsSync(meta) ? JSON.parse(readFileSync(meta, "utf8")) : {};
  // the clip normally starts when the first page has loaded; "startAt" starts it at a marked moment instead
  // (e.g. after dismissing a "resume draft" banner), so leftovers from earlier sessions never show
  // Under heavy load the browser's screen recorder can fall behind real time (a 12 s shot becomes a 6 s video).
  // Compare the video's own length with the real duration and rescale every recorded time accordingly.
  const clipLen = Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", clip], { encoding: "utf8" }).trim());
  const k = metaData.wall && clipLen > 0 ? Math.min(1, clipLen / metaData.wall) : 1;
  if (k < 0.92) console.warn(`WARNING shot ${s.id}: the recording ran slowly (video is ${(k * 100).toFixed(0)}% of real time). Times were rescaled, but free memory/CPU and re-record for best results.`);
  if (k < 1 && metaData.marks) metaData.marks = Object.fromEntries(Object.entries(metaData.marks).map(([n, t]) => [n, t * k]));
  let start = (metaData.startOffset ?? 0) * k;
  if (s.startAt && metaData.marks?.[s.startAt] !== undefined) start = metaData.marks[s.startAt] + (s.startDelay ?? 0.3);
  const speed = s.speed ?? DEFAULT_SPEED;
  // ramps fast-forward the dead time between two marked moments, e.g. {from:"submit", to:"answer", speed:5}
  const ramps = (s.ramps ?? [])
    .map((r) => ({ a: (metaData.marks?.[r.from] ?? NaN) - start, b: (metaData.marks?.[r.to] ?? NaN) - start, sp: r.speed ?? 4 }))
    .filter((r) => Number.isFinite(r.a) && Number.isFinite(r.b) && r.b > r.a)
    .sort((x, y) => x.a - y.a);
  const segs = [];
  let cur = 0;
  for (const r of ramps) { if (r.a > cur) segs.push({ a: cur, b: r.a, sp: speed }); segs.push({ a: r.a, b: r.b, sp: r.sp }); cur = r.b; }
  segs.push({ a: cur, b: null, sp: speed });
  // source time (s after the clip start) -> output time (s in the cut)
  const outTime = (t) => { let o = 0; for (const g of segs) { if (g.b === null || t <= g.b) return o + Math.max(0, t - g.a) / g.sp; o += (g.b - g.a) / g.sp; } return o; };
  const timing = ramps.length
    ? `[1:v]split=${segs.length}${segs.map((_, i) => `[t${i}]`).join("")};` +
      segs.map((g, i) => `[t${i}]trim=start=${g.a.toFixed(3)}${g.b === null ? "" : `:end=${g.b.toFixed(3)}`},setpts=(PTS-STARTPTS)/${g.sp}[u${i}];`).join("") +
      `${segs.map((_, i) => `[u${i}]`).join("")}concat=n=${segs.length}:v=1:a=0[sp];[sp]`
    : `[1:v]setpts=(PTS-STARTPTS)/${speed},`;
  const z = { x: 0.5, y: 0.45, scale: 1.12, ...s.zoom };
  const frames = Math.round(sc.dur * fps);
  const zoom = `zoompan=z='1+(${z.scale}-1)*min(on/${frames},1)':x='${z.x}*iw-iw/zoom/2':y='${z.y}*ih-ih/zoom/2':d=1:s=${ww}x${wh}:fps=${fps}`;
  const c = { x: 0, y: 0, w: 1, ...s.crop };
  const cropH = (c.w * srcAr) / winAr; // fraction of source height, so the crop matches the window's aspect
  if (cropH > 1) throw new Error(`shot ${s.id}: crop.w=${c.w} is too wide for this window shape; use w <= ${(winAr / srcAr).toFixed(2)}`);
  const cropF = `crop=w='in_w*${c.w}':h='in_h*${cropH.toFixed(5)}':x='in_w*${c.x}':y='min(in_h*${c.y},in_h-out_h)',`;
  const callouts = s.callouts ?? [];
  const filter =
    `${timing}fps=${fps},${cropF}scale=${ww * 2}:${wh * 2}:force_original_aspect_ratio=increase,crop=${ww * 2}:${wh * 2},setsar=1,${zoom},format=yuv420p[v];` +
    `[2:v]format=gray,scale=${ww}:${wh}[m];[v][m]alphamerge[win];` +
    `[win]scale=w='trunc(${ww}*(0.9+0.1*${E(0, 0.5)})/2)*2':h='trunc(${wh}*(0.9+0.1*${E(0, 0.5)})/2)*2':eval=frame[w2];` +
    `[0:v][w2]overlay=x='(W-w)/2':y='${wcy}-h/2':eval=frame:format=auto[b];` +
    `[3:v]format=rgba,fade=t=in:st=0.1:d=0.3:alpha=1[c];` +
    `[b][c]overlay=x=0:y='${Math.round(H * 0.04)}*pow(1-min(max(t-0.1,0)/0.5,1),3)':eval=frame:format=auto[o0];` +
    callouts.map((co, k) => {
      // `after: "<mark>"` pins the callout to a real moment recorded by a marked step (plus optional delay)
      let at = co.at ?? 0.8;
      if (co.after !== undefined) {
        const m = metaData.marks?.[co.after];
        if (m === undefined) console.warn(`shot ${s.id}: no mark "${co.after}" in footage; using at=${at}`);
        else at = Math.max(0, outTime(m - start) + (co.delay ?? 0));
      }
      const d = co.dur ?? 1.8;
      const X = (wx + co.x * ww).toFixed(1), Y = (wy + co.y * wh).toFixed(1);
      return `[${4 + k}:v]format=rgba,fade=t=in:st=${at}:d=0.25:alpha=1,fade=t=out:st=${(at + d - 0.25).toFixed(2)}:d=0.25:alpha=1[k${k}];` +
        `[o${k}][k${k}]overlay=x='min(max(${X}-w/2,${wx + 12}),${wx + ww - 12}-w)':y='${Y}-h/2+18*pow(1-min(max((t-${at})/0.35,0),1),3)':eval=frame:format=auto[o${k + 1}];`;
    }).join("") +
    `[o${callouts.length}]format=yuv420p[o]`;
  return [
    ...loopIn(P("stage.png"), sc.dur),
    "-ss", String(start), "-t", ramps.length ? "120" : (sc.dur * speed + 0.5).toFixed(3), "-i", clip,
    ...loopIn(P("mask.png"), sc.dur),
    ...loopIn(P(`cap${sc.i}.png`), sc.dur),
    ...callouts.flatMap((_, k) => loopIn(P(`co${sc.i}-${k}.png`), sc.dur)),
    "-filter_complex", filter, "-map", "[o]", ...encode(sc.dur, sc.out),
  ];
}

/** Card scene: a background plus staggered layers that slide up (or pop) and fade in. */
function cardArgs(sc, bg, layers) {
  const inputs = [...loopIn(bg, sc.dur)];
  let chain = "";
  let cur = "[0:v]";
  layers.forEach((l, k) => {
    inputs.push(...(l.seq ? ["-framerate", String(fps), "-i", l.file] : loopIn(l.file, sc.dur)));
    const idx = k + 1;
    let pre = "format=rgba";
    if (l.crop) pre += `,crop=${l.crop.w}:${l.crop.h}:${l.crop.x}:${l.crop.y}`;
    if (l.pop) pre += `,scale=w='trunc(${l.w}*(0.84+0.16*${E(l.start, 0.55)})/2)*2':h=-1:eval=frame`;
    chain += `[${idx}:v]${pre},fade=t=in:st=${l.start}:d=0.3:alpha=1[L${k}];`;
    const xy = l.pop
      ? `x='(W-w)/2':y='${l.cy ?? H / 2}-h/2'`
      : `x=0:y='${Math.round(H * 0.045)}*pow(1-min(max(t-${l.start}-0,0)/0.5,1),3)'`;
    const out = k === layers.length - 1 ? "[o]" : `[c${k}]`;
    chain += `${cur}[L${k}]overlay=${xy}:eval=frame:format=auto${k === layers.length - 1 ? ",format=yuv420p" : ""}${out};`;
    cur = out;
  });
  return [...inputs, "-filter_complex", chain.replace(/;$/, ""), "-map", "[o]", ...encode(sc.dur, sc.out)];
}

function sceneArgs(sc) {
  if (sc.kind === "shot") return shotArgs(sc);
  if (sc.kind === "hook") {
    const n = sc.hook.lines.length;
    return cardArgs(sc, P("bare.png"), sc.hook.lines.map((_, k) => ({ file: P(`hook${sc.i}-${k}.png`), start: 0.05 + k * 0.3 })));
  }
  if (sc.kind === "stat") return cardArgs(sc, P("bare.png"), [{ file: P(`stat${sc.i}-%03d.png`), seq: true, start: 0.05, pop: true, w: W }]);
  // end card: logo pops in, tagline then URL follow
  const layers = [];
  if (hasLogo) {
    // modest by default: a logo is a signature, not a poster (override with end.logoWidth, a fraction of the width)
    const lw = even(Math.min(W * (end.logoWidth ?? 0.26), H * 0.18 * logoAspect));
    layers.push({ file: logo, start: 0.1, pop: true, w: lw, cy: H * 0.4, crop: logoCrop });
  } else {
    layers.push({ file: P("endlogo.png"), start: 0.1, pop: true, w: W, cy: H / 2 });
  }
  if (end.tagline) layers.push({ file: P("endtag.png"), start: 0.55 });
  if (end.line) layers.push({ file: P("endurl.png"), start: end.tagline ? 0.85 : 0.6 });
  return cardArgs(sc, P("endbg.png"), layers);
}

// ---------- render scenes in parallel ----------
const ff = (a) => run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...a], { maxBuffer: 1 << 26 });
async function pool(items, limit, fn) {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) { const it = items[next++]; await fn(it); }
  }));
}
await pool(scenes, 4, async (sc) => {
  try {
    await ff(sceneArgs(sc));
  } catch (e) {
    throw new Error(`scene ${sc.i} (${sc.kind}) failed:\n${e.stderr ?? e.message}`);
  }
});

// ---------- join with beat-aligned transitions ----------
const N = scenes.length;
const offsets = [];
let acc = 0;
for (let k = 1; k < N; k++) { acc += scenes[k - 1].n * beat; offsets.push(acc); } // = sum(dur) - k*D
const total = scenes.reduce((n, s) => n + s.n * beat, 0) + D;
let chain = "";
let prev = "[0:v]";
for (let k = 1; k < N; k++) {
  const tr = scenes[k].kind === "end" ? "fade" : style.transitions[(k - 1) % style.transitions.length];
  const out = k === N - 1 ? "[vout]" : `[x${k}]`;
  chain += `${prev}[${k}:v]xfade=transition=${tr}:duration=${D.toFixed(3)}:offset=${offsets[k - 1].toFixed(3)}${out};`;
  prev = out;
}
const joined = P("joined.mp4");
await ff([...scenes.flatMap((s) => ["-i", s.out]), "-filter_complex", chain.replace(/;$/, ""), "-map", "[vout]", "-c:v", "libx264", "-preset", "medium", "-crf", crf, "-pix_fmt", "yuv420p", joined]);

// ---------- soundtrack + mux ----------
const final = join(dir, "flaunt.mp4");
if (silent) {
  await ff(["-i", joined, "-c", "copy", "-movflags", "+faststart", final]);
} else {
  const cuts = offsets.map((o) => o + D / 2);
  writeWav(P("music.wav"), renderMusic(total, tone, cuts));
  await ff(["-i", joined, "-i", P("music.wav"), "-filter_complex", `[1:a]lowpass=f=15000,volume=${shotlist.music?.volume ?? 0.8},alimiter=limit=0.6:level=disabled[a]`, "-map", "0:v", "-map", "[a]", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-shortest", "-movflags", "+faststart", final]);
}
if (!args.includes("--keep")) rmSync(work, { recursive: true, force: true });
console.log(`wrote ${final}: ${total.toFixed(2)}s, ${bpm} BPM, ${N} scenes, rendered in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
