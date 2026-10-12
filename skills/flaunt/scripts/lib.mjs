import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

export const SHAPES = {
  wide: { w: 1920, h: 1080, viewport: { width: 1920, height: 1080 } },
  tall: { w: 1080, h: 1920, viewport: { width: 540, height: 960 } },
  square: { w: 1080, h: 1080, viewport: { width: 800, height: 800 } },
};

/** Footage is recorded at real speed and played back faster; this is the default speed-up per shot. */
export const DEFAULT_SPEED = 1.5;

const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\]|.+\.localhost|.+\.test)$/i;

/** Refuse to drive anything that is not a local development address. */
export function assertLocal(url) {
  const { hostname, host } = new URL(url);
  if (!LOCAL_HOST.test(hostname) && !LOCAL_HOST.test(host.replace(/:\d+$/, ""))) {
    throw new Error(
      `flaunt only records local development servers (localhost, 127.0.0.1, *.localhost, *.test). Refusing: ${url}`
    );
  }
}

export function loadShotlist(path, { requireShots = true } = {}) {
  const file = resolve(path);
  const shotlist = JSON.parse(readFileSync(file, "utf8"));
  const dir = dirname(file);
  if (!SHAPES[shotlist.shape ?? "wide"]) throw new Error(`Unknown shape: ${shotlist.shape}`);
  if (requireShots && (!Array.isArray(shotlist.shots) || shotlist.shots.length === 0)) {
    throw new Error("shotlist.json has no shots");
  }
  return { shotlist, dir, shape: SHAPES[shotlist.shape ?? "wide"] };
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function flag(args, name) {
  const i = args.indexOf(name);
  return i === -1 ? undefined : args[i + 1];
}
