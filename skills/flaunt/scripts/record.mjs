#!/usr/bin/env node
// Record each shot of a shotlist by driving the real app in Chromium.
// Usage: node record.mjs <shotlist.json> [--only s1,s2] [--url http://localhost:3000]
import { spawn } from "node:child_process";
import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";
import { assertLocal, DEFAULT_SPEED, flag, loadShotlist, sleep } from "./lib.mjs";
import { makeRunner } from "./steps.mjs";

const args = process.argv.slice(2);
const { shotlist, dir, shape } = loadShotlist(args[0]);
const only = flag(args, "--only")?.split(",");
const baseUrl = flag(args, "--url") ?? shotlist.app?.url ?? "http://localhost:3000";
assertLocal(baseUrl);

// Recording smaller than the output canvas makes the UI render larger in the final frame.
const viewport = shotlist.record?.viewport ?? shape.viewport;

const footage = join(dir, "footage");
mkdirSync(footage, { recursive: true });

// A visible cursor, since headless recordings do not draw one.
const CURSOR = `(() => {
  const dot = document.createElement("div");
  dot.style.cssText = "position:fixed;z-index:2147483647;width:30px;height:30px;margin:-6px 0 0 -6px;" +
    "border-radius:50%;background:rgba(20,20,20,.88);border:3px solid #fff;pointer-events:none;" +
    "box-shadow:0 3px 12px rgba(0,0,0,.4);transition:transform .08s;left:-80px;top:-80px";
  addEventListener("DOMContentLoaded", () => document.documentElement.appendChild(dot));
  addEventListener("mousemove", (e) => { dot.style.left = e.clientX + "px"; dot.style.top = e.clientY + "px"; }, true);
  addEventListener("mousedown", (e) => {
    dot.style.transform = "scale(.7)";
    const r = document.createElement("div");
    r.style.cssText = "position:fixed;z-index:2147483646;pointer-events:none;border-radius:50%;border:4px solid rgba(255,255,255,.9);" +
      "width:20px;height:20px;margin:-10px 0 0 -10px;left:" + e.clientX + "px;top:" + e.clientY + "px;" +
      "transition:transform .5s ease-out,opacity .5s ease-out;box-shadow:0 0 0 2px rgba(0,0,0,.25)";
    document.documentElement.appendChild(r);
    requestAnimationFrame(() => { r.style.transform = "scale(4)"; r.style.opacity = "0"; });
    setTimeout(() => r.remove(), 600);
  }, true);
  addEventListener("mouseup", () => { dot.style.transform = "scale(1)"; }, true);
})();`;

// Dev servers draw badges and error overlays (Next.js, Vite) that must never reach the video.
const HIDE_DEV_UI = `(() => {
  const css = "nextjs-portal,[data-nextjs-toast],[data-nextjs-dev-tools-button],vite-error-overlay{display:none!important}";
  const add = () => { const st = document.createElement("style"); st.textContent = css; document.documentElement.appendChild(st); };
  addEventListener("DOMContentLoaded", add);
})();`;

async function waitForServer(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.status < 500) return;
    } catch {}
    await sleep(500);
  }
  throw new Error(`App did not become ready at ${url} within ${timeoutMs} ms`);
}

let server;
function stopServer() {
  if (server?.pid) {
    try { process.kill(-server.pid, "SIGTERM"); } catch {}
  }
}
process.on("exit", stopServer);
process.on("SIGINT", () => process.exit(130));

if (shotlist.app?.start && !flag(args, "--url")) {
  console.log(`starting app: ${shotlist.app.start}`);
  server = spawn(shotlist.app.start, {
    shell: true,
    cwd: shotlist.app.cwd ?? process.cwd(),
    detached: true,
    stdio: "ignore",
  });
}
await waitForServer(baseUrl, shotlist.app?.readyTimeoutMs ?? 60000);

const runStep = makeRunner(baseUrl);
// patient runner for everything that is not on camera (sign-in, warm-up, rehearsal)
const runStepSlow = makeRunner(baseUrl, { waitTimeout: 90000 });

const browser = await chromium.launch();
let failed = false;

// Optional unrecorded setup (e.g. sign in). The resulting session is reused for every shot,
// so login screens and credentials never appear in the footage.
let storageState;
if (shotlist.app?.setup?.length) {
  console.log("running unrecorded setup");
  const setupCtx = await browser.newContext({ viewport });
  await setupCtx.addInitScript(HIDE_DEV_UI);
  const setupPage = await setupCtx.newPage();
  try {
    for (const step of shotlist.app.setup) await runStepSlow(setupPage, step);
    await setupPage.waitForLoadState("networkidle").catch(() => {});
    // Capture the signed-in session BEFORE warming: visiting pages can create drafts/local state
    // that must not leak into the recorded shots.
    storageState = await setupCtx.storageState();
    // Dev servers compile pages on first visit (seconds of blank screen). Visit every route the shots use,
    // in a throwaway context, so compiles never show in footage and no state is carried over.
    if (shotlist.app.warmup !== false) {
      const routes = [...new Set([...shotlist.shots.filter((s) => s.steps).flatMap((s) => s.steps.filter((x) => x.goto !== undefined).map((x) => x.goto)), ...(shotlist.app.warm ?? [])])];
      const warmCtx = await browser.newContext({ viewport, storageState });
      const warmPage = await warmCtx.newPage();
      for (const route of routes) {
        console.log(`warming ${route}`);
        await runStepSlow(warmPage, { goto: route }).catch((e) => console.warn(`  warm-up of ${route} failed: ${e.message.split("\n")[0]}`));
        // wait for the page's own data requests to finish: cold dev servers compile every API route on first use
        await warmPage.waitForLoadState("networkidle", { timeout: 60000 }).catch(() => {});
        await warmPage.waitForTimeout(600);
      }
      // Rehearsal: run the chosen flows once, unrecorded. First calls to lazily compiled API routes are slow or fail
      // ("Could not send your message"), and flaky flows are better discovered here than on camera.
      // default: rehearse every flow once (set "rehearse": false to skip, or list shot ids)
      const rehearse = shotlist.app.rehearse === false ? [] : Array.isArray(shotlist.app.rehearse) ? shotlist.app.rehearse : shotlist.shots.filter((s) => s.steps).map((s) => s.id);
      for (const id of rehearse) {
        const shot = shotlist.shots.find((s) => s.id === id);
        if (!shot?.steps) continue;
        console.log(`rehearsing ${id}`);
        for (const step of shot.steps) {
          try { await runStepSlow(warmPage, step); } catch (e) { console.warn(`  rehearsal of ${id} hit: ${e.message.split("\n")[0]}`); break; }
        }
        await warmPage.waitForTimeout(800);
      }
      await warmCtx.close();
    }
  } catch (err) {
    console.error(`setup failed: ${err.message}`);
    await setupPage.screenshot({ path: join(footage, "setup-error.png") }).catch(() => {});
    await browser.close();
    stopServer();
    process.exit(1);
  }
  await setupCtx.close();
}

for (const shot of shotlist.shots) {
  if (!shot.steps) continue; // card scenes (stats) have nothing to record
  if (only && !only.includes(shot.id)) continue;
  console.log(`recording ${shot.id}: ${shot.caption ?? ""}`);

  const ctx = await browser.newContext({
    viewport,
    storageState,
    recordVideo: { dir: footage, size: viewport },
  });
  await ctx.addInitScript(CURSOR);
  await ctx.addInitScript(HIDE_DEV_UI);
  const page = await ctx.newPage();
  const created = Date.now();
  let startOffset = 0;

  try {
    const marks = {};
    let waitingForReady = false;
    for (const [i, step] of shot.steps.entries()) {
      // "mark" labels a real moment (e.g. the answer appearing) so callouts and speed ramps can attach to it.
      // For key presses the moment is the press itself, not the end of any retry wait.
      if (step.mark && step.press) { marks[step.mark] = (Date.now() - created) / 1000; shot.__marks = marks; }
      await runStep(page, step);
      if (step.mark && !step.press) { marks[step.mark] = (Date.now() - created) / 1000; shot.__marks = marks; }
      // The clip starts when the page is READY, not merely navigated: after the first navigation, and then again
      // at the first "waitFor" that comes before any interaction (so loading skeletons and empty tables never show).
      const now = (Date.now() - created) / 1000;
      if (i === 0 && step.goto !== undefined) { startOffset = now; waitingForReady = true; }
      else if (waitingForReady && step.waitFor) { startOffset = now; waitingForReady = false; }
      else if (step.click || step.type || step.press || step.hover || step.scroll) waitingForReady = false;
    }
    const speed = shot.speed ?? DEFAULT_SPEED;
    const needed = startOffset * 1000 + ((shot.seconds + 0.5) * speed + 0.4) * 1000;
    const remaining = needed - (Date.now() - created);
    if (remaining > 0) await sleep(remaining);
  } catch (err) {
    failed = true;
    console.error(`  ${shot.id} failed: ${err.message}`);
    await page.screenshot({ path: join(footage, `${shot.id}-error.png`) }).catch(() => {});
  }

  const video = page.video();
  await ctx.close();
  if (video) {
    const tmp = await video.path();
    renameSync(tmp, join(footage, `${shot.id}.webm`));
    writeFileSync(join(footage, `${shot.id}.json`), JSON.stringify({ startOffset, marks: shot.__marks ?? {}, wall: (Date.now() - created) / 1000 }));
  }
}

await browser.close();
stopServer();
process.exit(failed ? 1 : 0);
