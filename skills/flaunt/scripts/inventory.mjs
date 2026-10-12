#!/usr/bin/env node
// Read a codebase and rank what the product can DO, so the video tells the whole story.
//
// Usage: node inventory.mjs <projectDir> [--out inventory.json] [--top 25]
//
// It gathers evidence (README structure, routes/screens, source modules, docs, tests), merges it into
// capability candidates, and scores each by how much of the product it occupies. It does NOT decide what
// matters: you classify the candidates into tiers in product-map.md. Nothing here is sent anywhere.
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, join, relative, sep } from "node:path";
import { flag } from "./lib.mjs";

const args = process.argv.slice(2);
const root = args[0] ? join(process.cwd(), args[0]) : process.cwd();
const rootAbs = args[0]?.startsWith("/") ? args[0] : root;
const top = Number(flag(args, "--top") ?? 25);
if (!existsSync(rootAbs)) { console.error(`not found: ${rootAbs}`); process.exit(2); }

const SKIP = new Set(["node_modules", ".git", ".next", "dist", "build", "out", ".turbo", ".pnpm-store", "coverage", ".venv", "venv", "__pycache__", "vendor", "target", ".cache", ".flaunt", "test-results", ".idea", ".vscode"]);
const CODE = /\.(tsx?|jsx?|mjs|cjs|py|rb|go|rs|java|kt|php|vue|svelte|cs|swift)$/;
const TEST = /(\.|_)(test|spec)\.|__tests__|\/tests?\//;
const read = (p, max = 400_000) => { try { return readFileSync(p, "utf8").slice(0, max); } catch { return ""; } };

// ---- walk ----
const files = [];
(function walk(dir, depth) {
  if (depth > 9 || files.length > 60_000) return;
  let entries; try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    if (e.name.startsWith(".") && e.name !== ".github") continue;
    if (SKIP.has(e.name)) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, depth + 1);
    else if (e.isFile()) { try { files.push({ p, rel: relative(rootAbs, p), size: statSync(p).size }); } catch {} }
  }
})(rootAbs, 0);

// ---- project identity ----
let pkg = {};
try { pkg = JSON.parse(read(join(rootAbs, "package.json"))); } catch {}
const readmePath = ["README.md", "readme.md", "README.rst", "README"].map((n) => join(rootAbs, n)).find(existsSync);
const readme = readmePath ? read(readmePath) : "";
const h1 = readme.match(/^#\s+(.+)$/m)?.[1] ?? pkg.name ?? basename(rootAbs);
const firstParas = readme.replace(/<[^>]+>/g, " ").split(/\n{2,}/).map((s) => s.trim()).filter((s) => s && !s.startsWith("#") && !s.startsWith("[") && !s.startsWith("|") && !s.startsWith("```") && s.length > 40).slice(0, 3);
const deps = { ...pkg.dependencies, ...pkg.devDependencies };
const stack = ["next", "react", "vue", "svelte", "express", "fastify", "nestjs", "@nestjs/core", "django", "flask", "fastapi", "rails", "drizzle-orm", "prisma", "playwright"].filter((d) => deps[d]);

// ---- README structure: headings with the amount of text under each ----
const sections = [];
{
  const lines = readme.split("\n");
  let cur = null;
  for (const l of lines) {
    const m = l.match(/^(#{2,3})\s+(.+)/);
    if (m) { cur = { level: m[1].length, title: m[2].replace(/[*_`]/g, "").trim(), words: 0 }; sections.push(cur); }
    else if (cur) cur.words += (l.match(/\w+/g) ?? []).length;
  }
}

// ---- routes / screens ----
const routes = new Set();
for (const { rel } of files) {
  let m;
  if ((m = rel.match(/(?:^|\/)app\/(.*)\/page\.(tsx|jsx|ts|js)$/)) || (m = rel.match(/(?:^|\/)app\/(page)\.(tsx|jsx|ts|js)$/))) {
    routes.add("/" + (m[1] === "page" ? "" : m[1]).replace(/\([^)]*\)\/?/g, ""));
  } else if ((m = rel.match(/(?:^|\/)pages\/(.*)\.(tsx|jsx|ts|js|vue)$/)) && !/^(_|api\/)/.test(m[1])) {
    routes.add("/" + m[1].replace(/\/?index$/, ""));
  } else if ((m = rel.match(/(?:^|\/)routes\/(.*?)\/?\+page\.(svelte|ts)$/))) {
    routes.add("/" + m[1]);
  }
}
// plain static sites: every .html page is a screen ("index.html" -> "/", "tasks.html" -> "/tasks")
for (const { rel } of files) {
  const m = rel.match(/^(?:(?:public|static|www|site|docs|dist|src)\/)?(?:([\w\-\/]+)\/)?([\w\-]+)\.html$/);
  if (!m || /node_modules|\.flaunt/.test(rel)) continue;
  const base = m[2] === "index" ? "" : m[2];
  routes.add("/" + [m[1], base].filter(Boolean).join("/"));
}
for (const { p, rel } of files) {
  if (!CODE.test(rel) || TEST.test(rel) || files.length > 20_000) continue;
  const src = read(p, 60_000);
  for (const m of src.matchAll(/\b(?:router|app|server)\.(?:get|use)\(\s*['"`](\/[\w\-/:]*)['"`]/g)) routes.add(m[1]);
  for (const m of src.matchAll(/\bpath:\s*['"`](\/[\w\-/:]*)['"`]/g)) routes.add(m[1]);
}
const routeList = [...routes].map((r) => r.replace(/\/+$/, "") || "/").filter((r) => !/\[|\]|:|\{/.test(r) || true).sort();
const groups = {};
for (const r of routeList) {
  const seg = r.split("/").filter(Boolean)[0] ?? "(root)";
  (groups[seg] ??= []).push(r);
}

// ---- source modules (directories under src/ and packages/*/src) ----
const modules = {};
for (const { rel, size } of files) {
  if (!CODE.test(rel)) continue;
  const parts = rel.split(sep.replace("\\", "/")).join("/").split("/");
  const si = parts.lastIndexOf("src");
  let key = null;
  if (si >= 0 && parts.length > si + 2) key = parts.slice(0, si + 2).join("/");
  else if (parts[0] === "packages" && parts.length > 2) key = parts.slice(0, 2).join("/");
  else if (parts.length > 2 && ["lib", "app", "server", "services", "core", "api"].includes(parts[0])) key = parts.slice(0, 2).join("/");
  if (!key) continue;
  const m = (modules[key] ??= { dir: key, files: 0, tests: 0, approxLoc: 0 });
  if (TEST.test("/" + rel)) m.tests++; else { m.files++; m.approxLoc += Math.round(size / 38); }
}

// ---- docs ----
const docs = files.filter((f) => /\.mdx?$/.test(f.rel) && /(^|\/)docs?\//.test(f.rel) && f.size > 300).map((f) => ({ file: f.rel, title: read(f.p, 2000).match(/^#\s+(.+)$/m)?.[1] ?? basename(f.rel), words: Math.round(f.size / 6) }));
const docText = docs.map((d) => read(join(rootAbs, d.file), 200_000).toLowerCase()).join("\n");
const readmeLower = readme.toLowerCase();

// ---- capability candidates ----
const tok = (s) => s.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 2).map((t) => t.replace(/(ies)$/, "y").replace(/s$/, ""));
const STOP = new Set(["api", "src", "lib", "app", "page", "new", "the", "and", "settings", "index", "util", "common", "shared", "ui", "web", "core", "test", "type", "config", "setting", "seed", "component", "base", "sub", "util", "helper", "hook", "store", "model", "service", "route", "layout", "style", "asset", "image", "public", "script", "tool", "main", "feature", "module", "item", "list", "detail"]);
const cands = new Map();
const touch = (name) => {
  const t = tok(name).filter((x) => !STOP.has(x));
  if (!t.length) return null;
  const key = t[0];
  if (!cands.has(key)) cands.set(key, { name: key, routes: [], modules: [], sections: [], docs: [] });
  return cands.get(key);
};
for (const [seg, rs] of Object.entries(groups)) { const c = touch(seg); if (c) c.routes.push(...rs); }
// sub-sections of "settings"-style hubs are capabilities too (e.g. /settings/connectors)
for (const [seg, rs] of Object.entries(groups)) {
  if (!/^(settings|admin|account|manage|console)$/.test(seg) || rs.length < 4) continue;
  const subs = {};
  for (const r of rs) { const s = r.split("/").filter(Boolean)[1]; if (s) (subs[s] ??= []).push(r); }
  for (const [s, rr] of Object.entries(subs)) { const c = touch(s); if (c) c.routes.push(...rr); }
}
for (const m of Object.values(modules)) { const c = touch(basename(m.dir)); if (c) c.modules.push(m); }
for (const s of sections) { const c = touch(s.title.split(/[\s/&(,:-]+/).find((w) => tok(w).some((x) => !STOP.has(x))) ?? s.title); if (c) c.sections.push(s); }
for (const d of docs) { const c = touch(basename(d.file).replace(/\.mdx?$/, "")); if (c) c.docs.push(d.file); }

const scored = [...cands.values()].map((c) => {
  const routeN = new Set(c.routes).size;
  const loc = c.modules.reduce((n, m) => n + m.approxLoc, 0);
  const tests = c.modules.reduce((n, m) => n + m.tests, 0);
  const mentions = (readmeLower.match(new RegExp(`\\b${c.name}`, "g")) ?? []).length;
  const docMentions = (docText.match(new RegExp(`\\b${c.name}`, "g")) ?? []).length;
  const readmeWords = c.sections.reduce((n, s) => n + s.words, 0);
  const score = 3 * Math.log2(1 + routeN) + 2 * Math.log2(1 + loc / 200) + 1.5 * Math.log2(1 + mentions) + Math.log2(1 + docMentions) + Math.log2(1 + readmeWords / 40) + 0.5 * Math.log2(1 + tests);
  return {
    capability: c.name, score: Math.round(score * 10) / 10,
    evidence: { routes: [...new Set(c.routes)].slice(0, 8), routeCount: routeN, modules: c.modules.map((m) => `${m.dir} (~${m.approxLoc} loc, ${m.tests} tests)`).slice(0, 4), readmeSections: c.sections.map((s) => s.title).slice(0, 4), readmeMentions: mentions, docs: c.docs.slice(0, 3) },
  };
}).filter((c) => c.score > 2).sort((a, b) => b.score - a.score);

const out = {
  project: { name: h1, packageName: pkg.name, description: pkg.description ?? null, stack, intro: firstParas },
  scale: { files: files.length, routes: routeList.length, routeGroups: Object.keys(groups).length, modules: Object.keys(modules).length, docs: docs.length },
  readmeSections: sections.filter((s) => s.level === 2).map((s) => ({ title: s.title, words: s.words })),
  routeGroups: Object.fromEntries(Object.entries(groups).sort((a, b) => b[1].length - a[1].length).slice(0, 30).map(([k, v]) => [k, { count: v.length, sample: v.slice(0, 5) }])),
  topModules: Object.values(modules).sort((a, b) => b.approxLoc - a.approxLoc).slice(0, 20),
  docs: docs.slice(0, 30),
  capabilityCandidates: scored.slice(0, top),
};
const outFile = flag(args, "--out");
if (outFile) writeFileSync(outFile, JSON.stringify(out, null, 2));

console.log(`# ${out.project.name}${out.project.description ? " - " + out.project.description : ""}`);
for (const p of out.project.intro) console.log(`  ${p.slice(0, 260).replace(/\s+/g, " ")}`);
console.log(`\nStack: ${stack.join(", ") || "(unknown)"}   Scale: ${out.scale.files} files, ${out.scale.routes} routes in ${out.scale.routeGroups} groups, ${out.scale.modules} modules, ${out.scale.docs} docs`);
console.log("\nCAPABILITY CANDIDATES (ranked by evidence; you decide the tiers):");
for (const [i, c] of out.capabilityCandidates.entries()) {
  const e = c.evidence;
  console.log(`${String(i + 1).padStart(2)}. ${c.capability.padEnd(16)} score ${String(c.score).padEnd(5)} routes:${e.routeCount} readme:${e.readmeMentions} ${e.routes[0] ? " e.g. " + e.routes.slice(0, 2).join(", ") : ""}${e.modules[0] ? "  | " + e.modules[0] : ""}`);
}
console.log("\nREADME sections: " + out.readmeSections.map((s) => `${s.title} (${s.words}w)`).slice(0, 22).join(" | "));
if (outFile) console.log(`\nfull JSON: ${outFile}`);
