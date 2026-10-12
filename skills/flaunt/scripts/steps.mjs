// Shared step runner for record.mjs and theme.mjs.
import { assertLocal, sleep } from "./lib.mjs";

// ${VAR} in step values is replaced from the environment, so secrets never live in shotlist.json.
export const sub = (v) =>
  typeof v === "string"
    ? v.replace(/\$\{(\w+)\}/g, (_, k) => {
        if (process.env[k] === undefined) throw new Error(`environment variable ${k} is not set`);
        return process.env[k];
      })
    : v;

// opts.waitTimeout: how long a "waitFor" may take. Recorded takes keep it short so real failures surface;
// setup, warm-up and rehearsal use a long one so a cold or busy machine does not abort the run.
export function makeRunner(baseUrl, opts = {}) {
const abs = (p) => (/^https?:/.test(p) ? p : new URL(p, baseUrl).toString());

async function glideTo(page, locator) {
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  if (!box) throw new Error("element has no bounding box");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 16 });
  await sleep(120);
}

async function runStep(page, step) {
  if (step.optional) {
    const sel = step.click ?? step.hover ?? step.waitFor;
    const there = sel ? await page.locator(sel).first().waitFor({ state: "visible", timeout: step.timeout ?? 1500 }).then(() => true).catch(() => false) : false;
    if (!there) return;
  }
  if (step.goto !== undefined) {
    const url = abs(sub(step.goto));
    assertLocal(url);
    // Frameworks often abort the first navigation while redirecting; tolerate that and wait for the final page.
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 90000 }).catch((e) => {
      if (!/ERR_ABORTED|interrupted by another navigation/.test(e.message)) throw e;
    });
    await page.waitForLoadState("load").catch(() => {});
  } else if (step.waitFor) {
    await page.locator(step.waitFor).first().waitFor({ state: "visible", timeout: step.timeout ?? opts.waitTimeout ?? 15000 });
  } else if (step.wait) {
    await sleep(step.wait);
  } else if (step.click) {
    const el = page.locator(step.click).first();
    await glideTo(page, el);
    await el.click();
  } else if (step.hover) {
    await glideTo(page, page.locator(step.hover).first());
  } else if (step.type) {
    const [selector, rawText, delay = 45] = step.type;
    const text = sub(rawText);
    const el = page.locator(selector).first();
    await glideTo(page, el);
    await el.click();
    await el.pressSequentially(text, { delay });
  } else if (step.press) {
    await page.keyboard.press(step.press);
    // Optional: a keypress can be dropped right after fast typing (hydration races). With "retryUntil" the key
    // is pressed again until that selector/URL appears (up to 2 more times, 6 s apart); harmless for submits, since an
    // emptied input ignores a second Enter.
    if (step.retryUntil || step.retryUntilUrl) {
      for (let i = 0; i < 2; i++) {
        const seen = step.retryUntilUrl
          ? await page.waitForURL((u) => u.toString().includes(step.retryUntilUrl), { timeout: step.retryAfter ?? 6000 }).then(() => true).catch(() => false)
          : await page.locator(step.retryUntil).first().waitFor({ state: "visible", timeout: step.retryAfter ?? 6000 }).then(() => true).catch(() => false);
        if (seen) break;
        await page.keyboard.press(step.press);
      }
    }
  } else if (step.scroll) {
    const chunks = 12;
    for (let i = 0; i < chunks; i++) {
      await page.mouse.wheel(0, step.scroll / chunks);
      await sleep(40);
    }
  } else {
    throw new Error(`unknown step: ${JSON.stringify(step)}`);
  }
}

return runStep;
}
