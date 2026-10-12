#!/usr/bin/env bash
# Check and prepare everything flaunt needs. Safe to re-run.
set -u
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
fail=0
missing() { printf '  missing: %s - %s\n' "$1" "$2"; fail=1; }

if command -v node >/dev/null 2>&1; then
  [ "$(node -v | sed 's/^v//' | cut -d. -f1)" -ge 20 ] || missing "Node 20+" "found $(node -v)"
else
  missing "node" "install Node 20+ from https://nodejs.org"
fi

for bin in ffmpeg ffprobe npm; do
  command -v "$bin" >/dev/null 2>&1 || missing "$bin" "macOS: brew install ffmpeg | Debian/Ubuntu: apt install ffmpeg"
done

if command -v ffmpeg >/dev/null 2>&1; then
  filters="$(ffmpeg -hide_banner -filters 2>/dev/null)"
  for f in zoompan xfade alimiter; do
    printf '%s' "$filters" | grep -q " $f " || missing "ffmpeg $f filter" "install a full ffmpeg build"
  done
fi

# Can Chromium start? (the only check that matters for recording)
chromium_ok() {
  (cd "$here" && node --input-type=module -e 'import("playwright").then(async ({chromium}) => { const b = await chromium.launch(); await b.close(); }).catch(() => process.exit(1))' >/dev/null 2>&1)
}

if [ "$fail" -eq 0 ]; then
  if [ ! -d "$here/node_modules/playwright" ]; then
    echo "installing Playwright into $here ..."
    (cd "$here" && npm install --no-audit --no-fund) || missing "playwright" "npm install failed"
  fi
fi

if [ "$fail" -eq 0 ]; then
  if chromium_ok; then
    echo "chromium: launches fine (no download needed)"
  else
    echo "chromium: not launchable yet, installing ..."
    (cd "$here" && npx playwright install chromium) || true
    if ! chromium_ok; then
      missing "chromium" "could not launch. If this shell is sandboxed (macOS Seatbelt, containers), Chromium and local servers must run unsandboxed: re-run outside the sandbox, or allow it."
    fi
  fi
fi

if [ "$fail" -ne 0 ]; then
  echo "flaunt doctor: NOT READY"
  exit 1
fi
echo "flaunt doctor: ready"
