# Craft: what separates a launch video from a screen recording

> A launch video is a **story about a product**, told through **live flows**. If it looks like screenshots being
> added, it fails. If it shows screens nobody can connect to the product's purpose, it fails.

Hold every cut to this list. Weak launch videos fail on pace, focus, and fit with the brand.

## Tell the whole product (before you film anything)

- Read the codebase (`inventory.mjs`) and the README; decide the product's purpose and category in its own words.
- Classify capabilities: **Tier 1 pillars (3-5) are shown live**, Tier 2 proof/outputs briefly or as stats, Tier 3
  depth only as a stat or the end line. Order pillars by dependency: inputs -> intelligence -> control -> outputs.
- A viewer who sees the video should be able to say what the product is, what its 3-5 pillars are, and why it is
  different, without reading anything else.
- The end line is the product's **category** ("Project tracking for product teams"), not a slogan you invented.

## It must feel alive

- Every flow shows a **state change**: typing then an answer arriving; a click opening a tab or page; describing
  something and watching it get built. Hover-only shots: at most two per video.
- **Callouts** name what is happening (pills pinned to the UI, timed to the real event). **Speed ramps** fast-forward
  waits so the agent "thinking" never drags. **Marks** keep both exact.
- Navigate the way a user would (click tabs, open items); never end on a spinner or an empty state.
- Record in the project's deterministic/mock mode: no paid or external calls, and results that repeat every take.

## Structure (23-40 s)

| Beat | Length | Job |
|------|--------|-----|
| Hook card | ~2 s | One claim a stranger understands instantly. Two lines max. Accent the payoff words. |
| Live flows x6-8 | ~3-4.5 s each | One pillar or proof each. A real interaction, not a still. Alternate screens. |
| Stat cards x1-2 | ~2 s each | A real, verified number, big, counting up. Place between shots. |
| End card | ~4 s | **The logo** (smaller than you think: about a quarter of the width) and the category line. No URL unless the user asked. |

The logo is always the last frame. The end card matches the logo's own background when the
logo is opaque (the composer samples it); transparent logos sit on the themed stage.

## Pace

- Nothing lingers. Footage plays at 1.5x; shots are ~3 s; cuts land on the beat (scene
  lengths snap to the soundtrack tempo).
- Captions are <= 6 words, readable in the time on screen. "See what *needs you* first."
  not "Our dashboard surfaces items that require your attention."
- Never hold a static screen. If nothing moves, move the cursor, scroll, zoom, or cut.
- Total under 23 s feels thin; over 40 s loses people. Stay inside 23-40.

## Focus

- **The window is as wide as the caption block** and starts exactly where the caption starts
  (shared left/right margin). Don't shrink it.
- **Crop to the point:** remove the app's sidebar **and top bar** (`crop`) so no half-cut
  buttons or chips show at the window edges. Verify on a full-size frame.
- Zoom is a gentle push-in (1.05-1.15), not a lens. The window is already large.
- **Fill the window.** Narrow/short pages leave dead space: record at a smaller `record.viewport` (content
  width + ~15%) and keep zoom 1.05-1.12, since a push-in crops the edges (check the shot's *last* frame). The rule: content should fill about **60% or more of the window height**. For genuinely short pages, make that true by
  choosing a `record.viewport` height just above the content (`explore.mjs` prints `contentBox`), zoom 1.1-1.2, and put
  callouts on the content, not in the empty space. A short page that still cannot reach 60% is shown for at most one shot.
- **Lead with the cursor:** 2-3 `hover`/`click` steps per shot, left-to-right and
  top-to-bottom. Clicks show a ripple.
- Pages must be rich and deterministic. Spinners, empty states, error overlays, half-loaded
  UI, and stale links are cut, not captioned around.
- Don't run back-to-back shots from the same page; interleave screens.

## Words

- Hook = the category shift or the pain, not the product name.
- Captions describe what the viewer sees, in benefit terms. Accent (`*...*`) 1-3 words.
- Specific beats impressive: "87% of tasks on track" beats "full visibility".
- Every claim traceable to footage or the project's own docs.
- No URL, repo link, or install command on screen unless the user asks.

## Look: follow the product's theme

- Sample the real colours (`theme.mjs`). **Light product -> light stage with very light dots
  and dark text. Dark product -> dark stage.** Never impose a look the product doesn't have.
- The product sits in a framed, rounded window with a soft shadow on that stage. Captions go
  **above** the window, never on it.
- Accent colour comes from the product (a status/success colour or the logo), distinct from
  the text colour.
- Type is big and tight; one typeface.

## Sound

- Synthesized (no licences): drums, bass, chords, arp, sidechain pump. Style sets tempo:
  `bold` 120, `techy` 112, `warm` 100, `calm` 84 BPM.
- Whoosh on every cut, boom on the logo reveal (automatic).
- Mean loudness about -10 dB, peaks under -0.5 dB. With voice-over, set `music.volume` 0.4.

## Review (before you say it is done)

Look at a contact sheet (1.5 fps) **and** at least one full-size frame. Fail the cut if any is true:

- [ ] Length is under 23 s or over 40 s
- [ ] The video does not cover the Tier-1 pillars from product-map.md, or shows something that is not in the map
- [ ] Fewer than two-thirds of the flows show a state change (type -> result, click -> new view)
- [ ] A callout names something that is NOT visible on screen at that moment (e.g. "Search every task" over an empty list)
- [ ] A callout appears before or after the event it names, or two callouts overlap
- [ ] A loading spinner, "thinking" state or stale leftover (draft banner, old messages) is on screen for > 0.7 s
- [ ] The end-card logo dominates the frame, or the end line is not the product's category
- [ ] The video's look doesn't match the product's theme (dark stage on a light product, etc.)
- [ ] A caption is cut off, overlaps the product, or has a missing space
- [ ] The window is mostly empty (content under ~60% of the window height) with no viewport/zoom fix, or a callout floats in dead space
- [ ] The product window doesn't start at the caption's left edge, or UI at the window edge
      is clipped (half buttons, chips, sidebars)
- [ ] Any frame shows an error overlay, dev badge, spinner, or empty state
- [ ] Any frame shows a login form, credential, email, token, or real customer data
- [ ] The logo is not the final frame, is cropped, sits in a visible box, or is off-centre (padded SVG/PNG; the composer now trims transparent padding)
- [ ] A URL or repo link appears that the user did not ask for
- [ ] A shot has no motion for more than ~1 s, or 3+ shots in a row show the same screen
- [ ] A number or claim is not visible in the footage or docs
- [ ] No audio stream (unless `--silent`)

Then ask: if I only saw the first two seconds, would I keep watching?
