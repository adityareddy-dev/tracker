#!/usr/bin/env node
// Command-line updates for the tracker. Same encryption as index.html, same data.json in the repo.
//
//   node cli.mjs show                                   status summary
//   node cli.mjs next                                   what is moving, blocked, waiting, or due soon
//   node cli.mjs json                                   decrypted JSON to stdout
//   node cli.mjs task "<match>" --status done [--date YYYY-MM-DD] [--note "..."] [--in <category-id>]
//   node cli.mjs add <category-id> "<name>" [--status doing] [--date ...] [--note "..."]
//   node cli.mjs journal <category-id|general> "<text>" [--date YYYY-MM-DD]
//   node cli.mjs milestone "<match>" [--done] [--date YYYY-MM-DD] [--name "..."]
//   node cli.mjs push <file.json>                       replace the whole state from a plaintext file
//   node cli.mjs categories                             ids to use with add and journal
//
// Passphrase: TRACKER_PASS, else the macOS keychain item "tracker-passphrase".
// Token: GH_TOKEN, else `gh auth token`. Add --dry to any change to see it without saving.
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { webcrypto as crypto } from "node:crypto";

const OWNER = "adityareddy-dev", REPO = "tracker", PATH = "data.json", BRANCH = "main";
const STATUSES = ["todo", "doing", "done", "waiting", "blocked", "closed"];
const WORD = { done: "done", doing: "in progress", todo: "not started", waiting: "waiting", blocked: "blocked", closed: "closed" };

const args = process.argv.slice(2);
const flags = {};
const positional = [];
for (let i = 0; i < args.length; i++) {
  if (args[i].startsWith("--")) {
    const k = args[i].slice(2);
    if (k === "dry" || k === "done") flags[k] = true;
    else flags[k] = args[++i];
  } else positional.push(args[i]);
}
const [cmd, ...rest] = positional;

function today() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; }
function die(msg) { console.error(msg); process.exit(1); }
function sh(cmd, a) { return execFileSync(cmd, a, { encoding: "utf8" }).trim(); }
function passphrase() {
  if (process.env.TRACKER_PASS) return process.env.TRACKER_PASS;
  try { return sh("security", ["find-generic-password", "-s", "tracker-passphrase", "-w"]); }
  catch { die("No passphrase. Set TRACKER_PASS or add a keychain item named tracker-passphrase."); }
}
function token() {
  if (process.env.GH_TOKEN) return process.env.GH_TOKEN;
  try { return sh("gh", ["auth", "token"]); }
  catch { die("No GitHub token. Run gh auth login or set GH_TOKEN."); }
}
function validDate(s) { return /^\d{4}-\d{2}-\d{2}$/.test(s); }

const enc = new TextEncoder(), dec = new TextDecoder();
const b64 = { enc: (b) => Buffer.from(b).toString("base64"), dec: (s) => new Uint8Array(Buffer.from(s, "base64")) };
async function key(pass, salt, usage) {
  const base = await crypto.subtle.importKey("raw", enc.encode(pass), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", salt, iterations: 200000, hash: "SHA-256" }, base, { name: "AES-GCM", length: 256 }, false, [usage]);
}
async function decrypt(payload, pass) {
  const k = await key(pass, b64.dec(payload.salt), "decrypt");
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: b64.dec(payload.iv) }, k, b64.dec(payload.ct));
  return JSON.parse(dec.decode(pt));
}
async function encrypt(obj, pass) {
  const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
  const k = await key(pass, salt, "encrypt");
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, k, enc.encode(JSON.stringify(obj)));
  return { v: 1, salt: b64.enc(salt), iv: b64.enc(iv), ct: b64.enc(ct) };
}

const api = `https://api.github.com/repos/${OWNER}/${REPO}/contents/${PATH}`;
async function fetchPayload() {
  const r = await fetch(`${api}?ref=${BRANCH}&t=${Date.now()}`, { headers: { Accept: "application/vnd.github+json", Authorization: "Bearer " + token() } });
  if (!r.ok) die(`GitHub read failed (${r.status})`);
  const j = await r.json();
  return { sha: j.sha, payload: JSON.parse(Buffer.from(j.content, "base64").toString("utf8")) };
}
async function save(data, sha, message) {
  data.updated = today();
  const payload = await encrypt(data, PASS);
  if (flags.dry) { console.log("dry run, nothing saved"); return; }
  const body = { message, content: Buffer.from(JSON.stringify(payload)).toString("base64"), branch: BRANCH, sha };
  const r = await fetch(api, { method: "PUT", headers: { Accept: "application/vnd.github+json", Authorization: "Bearer " + token(), "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!r.ok) die(`GitHub save failed (${r.status}). ${(await r.text()).slice(0, 200)}`);
  const j = await r.json();
  console.log(`saved, commit ${j.commit.sha.slice(0, 7)}`);
}

function findTask(data, match, inCat) {
  const m = match.toLowerCase();
  const hits = [];
  for (const c of data.categories) {
    if (inCat && c.id !== inCat) continue;
    for (const t of c.tasks) if (t.name.toLowerCase().includes(m)) hits.push({ c, t });
  }
  if (hits.length === 1) return hits[0];
  if (!hits.length) die(`No task matches "${match}".`);
  die(`"${match}" matches ${hits.length} tasks. Narrow it or add --in <category-id>:\n` + hits.map(h => `  [${h.c.id}] ${h.t.name}`).join("\n"));
}
function findStone(data, match) {
  const m = match.toLowerCase();
  const hits = data.milestones.filter(s => s.name.toLowerCase().includes(m));
  if (hits.length === 1) return hits[0];
  if (!hits.length) die(`No milestone matches "${match}".`);
  die(`"${match}" matches ${hits.length} milestones:\n` + hits.map(s => "  " + s.name).join("\n"));
}
function daysUntil(iso) { if (!iso) return null; const [y, m, d] = iso.split("-").map(Number); const t = new Date(); t.setHours(0, 0, 0, 0); return Math.round((new Date(y, m - 1, d) - t) / 86400000); }
function catStats(c) { return [c.tasks.filter(t => t.status === "done" || t.status === "closed").length, c.tasks.length]; }

function show(data) {
  let done = 0, total = 0;
  for (const c of data.categories) if (c.counts) { const [r, n] = catStats(c); done += r; total += n; }
  console.log(`${data.title}, updated ${data.updated}. Readiness ${total ? Math.round(100 * done / total) : 0}% (${done} of ${total} counted tasks).`);
  if (data.target) console.log(`Earliest filing window ${data.target}, ${daysUntil(data.target)} days away.`);
  for (const c of data.categories) {
    const [r, n] = catStats(c);
    console.log(`\n${c.name} [${c.id}] ${r} of ${n} done${c.counts ? "" : ", not counted"}`);
    for (const t of c.tasks) console.log(`  ${t.status === "done" ? "x" : t.status === "closed" ? "-" : t.status === "doing" ? ">" : " "} ${t.name}${t.status !== "done" && t.status !== "todo" && t.status !== "closed" ? " [" + WORD[t.status] + "]" : ""}${t.date ? " (" + t.date + ")" : ""}${t.note ? ". " + t.note : ""}`);
  }
  if (data.milestones?.length) {
    console.log("\nMilestones");
    for (const s of [...data.milestones].sort((a, b) => (a.date || "9999") < (b.date || "9999") ? -1 : 1)) console.log(`  ${s.status === "done" ? "x" : " "} ${s.name} (${s.date || "no date"})`);
  }
  if (data.journal?.length) {
    console.log("\nJournal, latest first");
    for (const e of [...data.journal].sort((a, b) => a.date < b.date ? 1 : -1).slice(0, 8)) console.log(`  ${e.date}${e.cat ? " [" + e.cat + "]" : ""} ${e.text}`);
  }
}
function next(data) {
  for (const c of data.categories) for (const t of c.tasks) {
    if (t.status === "done" || t.status === "closed") continue;
    const n = daysUntil(t.date);
    if (["doing", "blocked", "waiting"].includes(t.status) || (n !== null && n <= 14)) console.log(`${WORD[t.status].padEnd(12)} ${t.name} [${c.id}]${t.date ? " " + t.date : ""}${t.note ? ". " + t.note : ""}`);
  }
}

const PASS = passphrase();
const { sha, payload } = await fetchPayload();
const data = await decrypt(payload, PASS).catch(() => die("Wrong passphrase."));
data.milestones ||= []; data.journal ||= [];

switch (cmd) {
  case "show": show(data); break;
  case "next": next(data); break;
  case "json": console.log(JSON.stringify(data, null, 2)); break;
  case "categories": for (const c of data.categories) console.log(`${c.id.padEnd(16)} ${c.name}`); break;
  case "task": {
    const [match] = rest; if (!match) die("task needs a match string.");
    const { c, t } = findTask(data, match, flags.in);
    const before = JSON.stringify(t);
    if (flags.status) { if (!STATUSES.includes(flags.status)) die("status must be one of " + STATUSES.join(", ")); t.status = flags.status; }
    if (flags.date !== undefined) { if (flags.date && !validDate(flags.date)) die("date must be YYYY-MM-DD"); if (flags.date) t.date = flags.date; else delete t.date; }
    if (flags.note !== undefined) { if (flags.note) t.note = flags.note; else delete t.note; }
    if (flags.name) t.name = flags.name;
    if (t.status === "done" && !t.date) t.date = today();
    if (JSON.stringify(t) === before) die("Nothing to change. Pass --status, --date, --note or --name.");
    console.log(`[${c.id}] ${t.name}: ${WORD[t.status]}${t.date ? " " + t.date : ""}${t.note ? ". " + t.note : ""}`);
    await save(data, sha, `tracker: ${t.name.slice(0, 50)} ${WORD[t.status]}`);
    break;
  }
  case "add": {
    const [cid, name] = rest; if (!cid || !name) die("add needs <category-id> and a name.");
    const c = data.categories.find(c => c.id === cid); if (!c) die(`No category ${cid}. Run: node cli.mjs categories`);
    const t = { name, status: flags.status || "todo" };
    if (!STATUSES.includes(t.status)) die("status must be one of " + STATUSES.join(", "));
    if (flags.date) { if (!validDate(flags.date)) die("date must be YYYY-MM-DD"); t.date = flags.date; }
    if (flags.note) t.note = flags.note;
    c.tasks.push(t);
    console.log(`added to ${c.name}: ${name}`);
    await save(data, sha, `tracker: add ${name.slice(0, 50)}`);
    break;
  }
  case "journal": {
    const [cid, text] = rest; if (!cid || !text) die("journal needs <category-id|general> and the entry text.");
    const e = { date: flags.date || today(), text };
    if (flags.date && !validDate(flags.date)) die("date must be YYYY-MM-DD");
    if (cid !== "general") { if (!data.categories.some(c => c.id === cid)) die(`No category ${cid}. Run: node cli.mjs categories`); e.cat = cid; }
    data.journal.push(e);
    console.log(`journal ${e.date}${e.cat ? " [" + e.cat + "]" : ""}: ${text}`);
    await save(data, sha, `tracker: journal ${e.date}`);
    break;
  }
  case "milestone": {
    const [match] = rest; if (!match) die("milestone needs a match string.");
    const s = findStone(data, match);
    if (flags.done) { s.status = "done"; if (!flags.date) s.date = today(); }
    if (flags.date) { if (!validDate(flags.date)) die("date must be YYYY-MM-DD"); s.date = flags.date; }
    if (flags.name) s.name = flags.name;
    console.log(`${s.name}: ${s.status === "done" ? "reached" : "ahead"} ${s.date}`);
    await save(data, sha, `tracker: milestone ${s.name.slice(0, 50)}`);
    break;
  }
  case "push": {
    const [file] = rest; if (!file) die("push needs a JSON file.");
    const j = JSON.parse(readFileSync(file, "utf8"));
    if (!j.categories || !j.criteria) die("That file is not tracker JSON.");
    console.log(`replacing state with ${file}`);
    await save(j, sha, `tracker: update ${today()}`);
    break;
  }
  default:
    console.log(readFileSync(new URL(import.meta.url), "utf8").split("\n").filter(l => l.startsWith("//")).map(l => l.slice(3)).join("\n"));
}
