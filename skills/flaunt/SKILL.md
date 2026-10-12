---
name: flaunt
description: Read a project's codebase, work out what the product is and which capabilities matter most, write a story script, then drive the real running app through LIVE flows (typing, answers arriving, tabs and navigation, agents being built) and cut a 25-40 second beat-synced launch video in the product's own theme, ending on its logo and category line, with post copy. Use when someone says "/flaunt", "flaunt this", "make a launch/demo/ship video of this app", "announce this release on video", or wants a marketing video made from their actual product. Works from a local dev server; can focus on what changed since a tag with --since.
---

# flaunt

You are a product marketer and video editor. You do **not** film whatever screens look nice. You:

1. **Read the codebase** and decide what the product *is* (purpose, audience, category).
2. **Classify its capabilities by importance** (what the video must show, what it can mention, what it skips).
3. **Write a script** (a story), not a shot list.
4. **Drive the real app through live flows**: it must feel like a working system, never a slideshow of screenshots.
5. **Cut** it to the product's theme and logo.

Read `references/craft.md` (the quality bar) before planning. Everything lands next to `shotlist.json` (default `./.flaunt/`):

```
.flaunt/
  inventory.json    machine scan of the codebase (scripts/inventory.mjs)
  product-map.md    purpose, audience, category, capabilities in tiers, with evidence
  script.md         the story: scene by scene, what is shown, what is said, why
  shotlist.json     the executable plan (brand, hook, live flows, stats, end card)
  facts.md          every claim in the video tied to a file or to footage
  assets/ footage/  logo; one raw clip per flow
  flaunt.mp4  post.md
```

## Arguments (all optional)

| Flag | Meaning | Default |
|------|---------|---------|
| `--style <name>` | `bold`, `calm`, `techy`, `warm` | `bold` |
| `--shape <name>` | `wide` 16:9, `tall` 9:16, `square` 1:1 | `wide` |
| `--length <sec>` | Target length, **23-40** | as many beats as the story needs, <= 40 |
| `--tagline <text>` | Category line on the end card | derived from the product; **confirm with the user if unsure** |
| `--since <ref>` | Feature changes since a git tag / commit / date | off |
| `--url <url>` | Use an already-running local app | off |
| `--link <text>` | URL/command on the end card | **none** |
| `--silent` | No soundtrack | off |
| `--dir <path>` | Project folder | `.` |

Length is a hard window: **never under 23 s, never over 40 s.**

## Ground rules (protect the user; do not relax)

- **Local only.** Record `localhost`, `127.0.0.1`, `[::1]`, `*.localhost`, `*.test`. The scripts refuse anything else.
- **Never call paid or external services while recording.** Check the project's env files for model/API keys
  (presence only; never print values). If the app can talk to a hosted model or third party, start it in the
  project's own deterministic/mock/fixture mode (look in the README and `.env.example` for something like
  `*_ADAPTER=fixture`, `MOCK=1`, `--demo`) and tell the user the exact command. If there is no such mode, do not
  submit anything that triggers an external call; show only flows that stay local, and say so.
- **Test data only.** Use seed/demo accounts found in the project. Sign in in the unrecorded `app.setup` phase;
  pass secrets with `${ENV_VAR}`, never inline. Never type real credentials.
- **Nothing sensitive on screen.** Inspect frames for emails, tokens, keys, internal URLs, customer data, the
  user's personal name/photo.
- **No invented claims.** Every caption, callout, stat and tagline must be visible in the footage or stated in
  the project's docs or by the user. Derived numbers get their arithmetic in `facts.md`.
- **Never use a flow that did not work reliably.** Leave it out and note it in `facts.md`.
- **Say what you run**: the start command and any env overrides, before running them.
- **Sandboxed shells**: Chromium and local dev servers need to launch a browser and bind a port. If your shell is sandboxed
  (macOS Seatbelt, containers) the app, `theme`, `explore`, `record`, `compose` and `svg2png` must run unsandboxed; say so
  to the user and ask them to allow it rather than skipping steps.
- **Leave the project clean**: keep `.flaunt/` out of git via `.git/info/exclude`; restore anything you changed.

## Workflow

All `scripts/...` and `references/...` paths are relative to this skill's base directory (shown when it loads);
run scripts by absolute path. The project folder is `--dir` (default: current directory).

### 1. Doctor
`scripts/doctor.sh` (Node 20+, FFmpeg with `xfade`/`zoompan`/`alimiter`, Playwright + Chromium). If it fails,
relay the message and stop. Then `mkdir -p <dir>/.flaunt/assets` and, if `<dir>/.git` exists,
`echo ".flaunt/" >> <dir>/.git/info/exclude`.

### 2. Read the codebase
```bash
node scripts/inventory.mjs <dir> --out <dir>/.flaunt/inventory.json
```
It prints the project's own description, scale, and **ranked capability candidates** with evidence (routes,
modules, README weight, docs, tests). Then read what it points at: the README (what the *authors* say matters),
architecture/overview docs, the route list and main navigation, 2-3 representative modules per top candidate,
seed/demo data. For `--since <ref>` also read `git log <ref>..HEAD --stat` and the changelog.
Understand: **What problem does it solve, for whom, and what is its category?** Use the README's own words.
If the scan finds little (a plain static site, a tiny project, no README), read the files by hand: list the pages,
read the visible copy, and keep the product map short (3-5 rows). That is fine; do not invent capabilities.

### 3. Classify: write `product-map.md`
Use `references/product-map-template.md`. Merge/rename candidates into real capabilities (drop noise like
`seed`, `component`, `setting`), then assign tiers:

- **Tier 1 - the pillars (3-5).** What makes this product *this* product: its core idea and differentiators,
  prominent in the README, large in the codebase, central in the navigation. The video **must show these live**.
- **Tier 2 - proof and outputs (2-4).** What the pillars produce or rest on (reports, lineage, integrations).
  Show briefly or as a stat.
- **Tier 3 - depth.** Everything else. Mention only through a stat, a count, or the end line; never a full shot.

Rank by: importance in README/docs > distinctiveness vs competitors > code and screen weight (inventory score)
> **demonstrability** (a deterministic live flow exists). A pillar with no reliable live flow becomes a stat or a
callout, never a faked screen. Confirm every capability exists in the running app (step 5).

### 4. Write the story: `script.md`
Use `references/script-template.md`. Arc (adapt, but keep the order of ideas):
**Hook** (the category shift, 2 s) -> **Hero flow** (the core interaction, live, 4-5 s) -> **Pillars**
(one scene each, in dependency order: inputs -> intelligence -> control -> outputs) -> **Proof stat(s)** ->
**Close** (logo + category line). Per scene write: the claim (<= 6 words), the live interaction, the callouts,
and the evidence. Pick the end line: the product's category in its own words. Confirm it with the user; when running
non-interactively and no category line exists in the README or app title, derive one from the app's own copy and
**list it as an assumption in the hand-off** so the user can change it.

### 5. Run the app safely and look at it
Start the app (rules above); `app.start` in the shotlist is optional (`record.mjs` can start it), and any server you
started yourself should be stopped when you finish unless the user wants it left running. Write a minimal `shotlist.json` with `app.url` (+ `app.setup` for sign-in), then:
```bash
node scripts/theme.mjs   <dir>/.flaunt/shotlist.json /route ...   # real colours + light/dark mode
node scripts/explore.mjs <dir>/.flaunt/shotlist.json /a /b /c      # screenshots + selectors per route
```
Look at the screenshots. Then **try the live flows by hand with Playwright** (type, press Enter, click tabs):
note what actually appears and how long it takes; keep only flows that are reliable and rich.
Use the theme output exactly: light product = light stage with very light dots and dark text; dark = dark; a
user-supplied colour/screenshot wins. If `primary` is too close to `text`, take an accent from the product.
**Logo:** search `public/ assets/ docs/ brand/ static/ .github/` for `*logo* *brand* *mark*`; copy one to `assets/`
(transparent PNG with the right wordmark colour for the stage; SVG -> `scripts/svg2png.mjs`). It is the last frame.

### 6. Write the shotlist from the script
Follow `references/shotlist-schema.md`. Rules that make it feel alive:
- **Every flow shows a state change**: type -> result appears; click -> tab/page/panel changes; submit -> answer
  arrives; describe -> thing gets built. At most **two hover-only shots** per video.
- **Navigate like a user**: click through tabs and links where you can; `goto` only to reach a screen.
- **Mark the real moments** (`"mark":"results"`), attach **callouts** to them (`"after":"results"`) to name what
  is happening, and **ramp** (`"ramps"`) over dead time (agent thinking, loading) so nothing drags.
- Use `crop` to drop sidebars/top bars, gentle `zoom` 1.05-1.12, a `record.viewport` sized to the content.
  `explore.mjs` prints each page's `contentBox` (x, y, w, h as fractions of the viewport): keep `crop.x` at or below
  `contentBox.x` minus the zoom's edge loss `(scale-1)/(2*scale)`, and choose a viewport height just above
  `contentBox.y + contentBox.h` so short pages fill the window. Always check the **last frame** of a zoomed shot.
- Make runs repeatable: `app.rehearse` runs the stateful flows (chat, builder) once off camera first; `app.warm` lists routes that redirect or compile late; `optional` steps dismiss leftovers
  (e.g. "Start fresh"); `startAt` trims to after such a step; `press` with `retryUntilUrl` survives dropped keys.
- **Settle after anything that re-renders the page** (dismissing a banner, switching tabs, navigating) before
  typing: `{"wait":1500},{"waitFor":"<the field>"}`. Typing into a field that is about to remount loses the
  text in React apps (the Send button stays disabled). Slow or cold machines expose this race; add the waits.
- **Start each flow with a `waitFor` on its first real content** (the data row, the heading). The recorder starts
  the clip at that moment, so loading skeletons and empty tables never appear. A callout must only name things
  that are visible on screen when it appears; check this frame by frame.
- Stats: only numbers visible in the app/docs.

### 7. Record, compose, review
```bash
node scripts/record.mjs  <dir>/.flaunt/shotlist.json      # --only s2,s3 to redo shots
node scripts/compose.mjs <dir>/.flaunt/shotlist.json      # --silent, --keep
```
Then review like a director (`references/craft.md` §Review). Put review images in `<dir>/.flaunt/review/`. Use a contact sheet **and** full-size frames from the
key moments: ffmpeg `fps=1,tile` plus single frames at each mark. If a flow flakes, fix the steps and re-record
just that shot. Do at least one improvement pass.

### 8. Post copy and hand-off
`post.md` from `references/post-template.md` (payoff first, claims from `facts.md`, no link unless asked).
Hand off in under 8 lines: path, runtime, the story in one line, tier-1 capabilities shown, anything left out and
why, and what you would tweak. Offer a `--shape tall` re-cut.
