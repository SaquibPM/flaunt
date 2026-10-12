# shotlist.json schema

```jsonc
{
  "name": "Acme",
  "shape": "wide",                      // wide | tall | square
  "style": "bold",                      // bold | calm | techy | warm  (tempo, type weight, transitions)
  "brand": {                            // run scripts/theme.mjs; do not invent a palette
    "mode": "light",                    // light | dark - follows the PRODUCT's theme (auto from bg if omitted)
    "bg": "#efede7",                    // stage = the product's outer page background
    "text": "#16161a",                  // dark text on a light stage, light text on a dark one
    "primary": "#3e6b4f"                // accent for *highlighted* words; must differ from text
  },

  "app": {                              // omit "start" when the app is already running
    "start": "npm run dev",
    "cwd": ".",
    "url": "http://localhost:3000",
    "readyTimeoutMs": 60000,
    "setup": [                          // optional, NOT recorded: sign in + warm up routes
      { "goto": "/login" },
      { "type": ["#email", "${FLAUNT_EMAIL}"] },       // ${VAR} comes from the environment
      { "type": ["#password", "${FLAUNT_PASSWORD}"] },
      { "click": "text=Sign in" }
    ]
  },

  "hook": { "lines": ["Shipping reports", "starts with a *question.*"], "seconds": 2 },

  "shots": [
    {
      "id": "s1",
      "caption": "Ask your *data* anything",     // *word* = accent colour. <= 5 words.
      "seconds": 2.5,                              // output length; snapped to whole beats
      "speed": 1.5,                                // playback speed-up (default 1.5)
      "steps": [                                   // run while recording
        { "goto": "/home" },
        { "waitFor": "#search" },
        { "type": ["#search", "auth middleware", 38] },   // optional 3rd value = ms per key
        { "hover": "text=Result" },
        { "wait": 400 }
      ],
      "crop": { "x": 0.215, "y": 0.1, "w": 0.78 },  // keep this part of the frame: drop the sidebar AND top bar
      "zoom": { "x": 0.5, "y": 0.4, "scale": 1.07 } // gentle push-in (1.05-1.15), fractions of the cropped frame
    },

    { "type": "stat", "value": "87%", "label": "of tasks *on track*", "seconds": 2 },

    { "id": "s2", "caption": "...", "seconds": 2.5, "steps": [] }
  ],

  "end": {
    "logo": "assets/logo.png",           // REQUIRED; relative to this file. Light stage -> dark-wordmark/transparent logo
    "tagline": "Every project in *one place*",
    // "line": "..."                     // URL/command pill: OMIT unless the user asked for a link
    "seconds": 4
  },

  "music": { "tone": "bold", "volume": 0.8 },    // omit for silent
  "render": { "fps": 30, "crf": 20 },
  "record": { "viewport": { "width": 1440, "height": 810 } }   // 1440x810 for wide; sharper than 1280x720
}
```

## Scene order

`hook` first, then `shots` in array order (footage shots and `stat` cards can interleave), then the
`end` card last. Card entries (those without `steps`) are not recorded.

## Step reference

| Step | Value | Notes |
|------|-------|-------|
| `goto` | path or URL | Relative paths join `app.url`; non-local URLs are refused |
| `waitFor` | selector | Preferred over fixed waits |
| `wait` | ms | 300-400 typical |
| `click` | selector | Playwright selectors (`text=`, `role=`, CSS); shows a click ripple |
| `hover` | selector | Moves the visible cursor there |
| `type` | `[selector, text, delayMs?]` | Human-paced typing; `${VAR}` allowed |
| `press` | key | `Enter`, `Meta+k` ... |
| `scroll` | px | Smooth wheel scroll |

## Rules

- Footage is recorded at real speed and played back at `speed`; `record.mjs` records enough
  source for it. Keep real-time steps short.
- Scene lengths snap to the soundtrack's beat so cuts land on it; expect +/- half a beat.
- Total length must land between **23 and 40 s** (about 28 s typical: hook 2 + 6-8 shots x 3 + stats 2 each + end 4).
- The product window spans the same left/right margins as the captions, so its aspect is wide
  (~2:1 on `wide`); `crop.w` must be <= window aspect / source aspect (about 1.13 for `wide`).
- Light themes get a beige/stage-coloured background with very light dots, dark text and a soft shadow; dark themes get the glow.
- `stat.value` numbers count up automatically (`"count": false` to disable).
- End card background auto-matches an opaque logo's own background; transparent logos get the brand stage.
- Only local URLs are allowed.

## Live-flow features (what makes it feel like a working system)

```jsonc
{
  "app": {
    "warm": ["/reports", "/settings"],               // extra routes to pre-visit (redirect targets, lazy pages)
    "rehearse": true                               // default: run every flow once, UNRECORDED, first (compiles lazy API routes, absorbs a flaky first submit); or list ids; false to skip
  },   // extra routes to pre-visit (redirect targets, lazy pages); shot routes are warmed automatically

  "shots": [{
    "id": "s1",
    "steps": [
      { "goto": "/home" },
      { "wait": 1, "mark": "typing" },                          // "mark" timestamps a real moment
      { "type": ["#q", "launch", 28] },
      { "press": "Enter", "mark": "submit", "retryUntilUrl": "/chat/" },   // key marks = the press; retries if the key was dropped
      { "waitFor": "text=Write launch announcement", "mark": "results" },
      { "click": "role=tab[name='Details']", "mark": "details" },
      { "click": "text=Start fresh", "optional": true }         // only if present (dismiss a leftover banner)
    ],
    "startAt": "fresh",                                         // start the clip at a mark (after leftovers are gone), +startDelay (default 0.3 s)
    "ramps": [{ "from": "submit", "to": "results", "speed": 5 }],// fast-forward dead time between two marks
    "callouts": [                                               // pills that name what is happening, pinned to the window
      { "text": "Type to search", "after": "typing", "delay": 0.1, "dur": 1.4, "x": 0.3, "y": 0.3 },
      { "text": "Results filter live", "after": "results", "dur": 0.9, "x": 0.72, "y": 0.5 },
      { "text": "Fixed-time callout", "at": 0.6, "dur": 1.5, "x": 0.5, "y": 0.2 }
    ]
  }],

  "end": {
    "logo": "assets/logo.png",
    "logoWidth": 0.26,                                          // fraction of the video width (default 0.26); a logo is a signature, not a poster
    "tagline": "Project tracking for *product teams*" // the product's category line; no URL unless asked
  }
}
```

- `x`,`y` of a callout are fractions of the product window (0-1); keep them off the controls the viewer must see.
- Callout `dur` should be short (0.9-1.8 s) and callouts must not overlap in time.
- `retryUntil` (selector) is the alternative to `retryUntilUrl`; prefer the URL form for submits that navigate.
- Mark times are real recording time; the composer converts them through speed and ramps, so callouts land on
  the actual event in the cut.
