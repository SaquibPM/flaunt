# product-map.md template

Write this after `scripts/inventory.mjs` and reading the code/docs. It is the single source of truth for what the
video is about. Keep it factual; every row cites evidence.

```markdown
# <Product> - product map

**Purpose (one sentence, README's own words where possible):** <what it does, for whom, to achieve what>
**Category line (candidate end-card tagline):** <e.g. "Project tracking for product teams"> - source: <README / app title / user>
**Audience:** <roles>
**What is different:** <2-3 differentiators the README/docs stress>

## Capabilities (classified)

| Tier | Capability | What it does for the user | Evidence (files / routes / docs) | Weight (inventory) | Live flow available? | Verdict |
|------|------------|---------------------------|-----------------------------------|--------------------|----------------------|---------|
| 1 | <Search / core interaction> | <type a query, results filter instantly> | `src/search`, `/tasks`, README "Search" | 31.4 | yes: type -> results filter live | SHOW LIVE |
| 1 | <Agents / workflows> | ... | ... | ... | yes: tabs, cards | SHOW LIVE |
| 2 | <Frameworks / outputs> | ... | ... | ... | partly | STAT + short shot |
| 3 | <API, webhooks, SSO> | ... | ... | ... | n/a | MENTION in stat/end line only |

## Left out (and why)
- <capability>: <no reliable live flow / not user-visible / too deep for 30 s>

## Verified numbers available for stats
- <number> - <where it is visible in the app/docs> - <arithmetic if derived>
```

Tier rules: **1** = the pillars that define the product (3-5, must be shown live); **2** = proof/outputs (2-4,
brief); **3** = depth (stat or end line only). Rank by README prominence > distinctiveness > code/screen weight >
demonstrability.
