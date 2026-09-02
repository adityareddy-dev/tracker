// Encrypts progress.json into data.json in exactly the format index.html expects.
// Usage: TRACKER_PASS='your passphrase' node seed.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { webcrypto as crypto } from "node:crypto";
const pass = process.env.TRACKER_PASS;
if (!pass || pass.length < 8) { console.error("Set TRACKER_PASS to a passphrase of at least 8 characters."); process.exit(1); }
const enc = new TextEncoder();
const b64 = (bytes) => Buffer.from(bytes).toString("base64");
const data = JSON.parse(readFileSync("progress.json", "utf8"));
const salt = crypto.getRandomValues(new Uint8Array(16));
const iv = crypto.getRandomValues(new Uint8Array(12));
const base = await crypto.subtle.importKey("raw", enc.encode(pass), "PBKDF2", false, ["deriveKey"]);
const key = await crypto.subtle.deriveKey({ name: "PBKDF2", salt, iterations: 200000, hash: "SHA-256" }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt"]);
const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(JSON.stringify(data)));
writeFileSync("data.json", JSON.stringify({ v: 1, salt: b64(salt), iv: b64(iv), ct: b64(ct) }));
console.log("data.json written, " + data.categories.length + " categories encrypted.");
