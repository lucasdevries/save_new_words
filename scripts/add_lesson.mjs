// Add a shared lesson (visible to all users) from a CSV file.
//
//   node scripts/add_lesson.mjs <admin-email> <password> <lesson-title> <file.csv>
//
// The CSV uses the learn_words format: header `nl,fr`, one word pair per
// line. Writing sharedLessons/sharedWords requires the admin account (see
// firestore.rules); other accounts get "insufficient permissions".
import { readFileSync } from "node:fs";

const API_KEY = "AIzaSyA-xLFkIiD5xa1slSFU8FazX-h9nC_-4gk";
const DOCS = "projects/save-new-words/databases/(default)/documents";
const [email, password, title, csvPath] = process.argv.slice(2);
if (!csvPath) {
  console.error("Usage: node scripts/add_lesson.mjs <admin-email> <password> <lesson-title> <file.csv>");
  process.exit(1);
}

// Minimal CSV parser (handles quoted fields with commas and "" escapes).
function parseCsv(text) {
  const rows = []; let row = [], field = "", inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') inQ = false;
      else field += c;
    } else if (c === '"') inQ = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.some(f => f.trim())) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some(f => f.trim())) rows.push(row);
  return rows;
}

const pairs = parseCsv(readFileSync(csvPath, "utf8").replace(/^\uFEFF/, ""))
  .map(r => [r[0]?.trim(), r[1]?.trim()])
  .filter(([nl, fr]) => nl && fr && !(nl.toLowerCase() === "nl" && fr.toLowerCase() === "fr"));
if (!pairs.length) { console.error("No word pairs found in", csvPath); process.exit(1); }

const signIn = await fetch(
  `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${API_KEY}`,
  { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, returnSecureToken: true }) });
const auth = await signIn.json();
if (!auth.idToken) { console.error("Login failed:", auth.error?.message); process.exit(1); }
const H = { "Content-Type": "application/json", Authorization: `Bearer ${auth.idToken}` };

async function createDoc(col, fields, retries = 3) {
  const resp = await fetch(`https://firestore.googleapis.com/v1/${DOCS}/${col}`,
    { method: "POST", headers: H, body: JSON.stringify({ fields }) });
  if (!resp.ok) {
    if (retries > 0) { await new Promise(r => setTimeout(r, 1000)); return createDoc(col, fields, retries - 1); }
    throw new Error(`${col}: ${(await resp.json()).error?.message}`);
  }
  return (await resp.json()).name.split("/").pop();
}

// Refuse a duplicate lesson title.
const existing = await fetch(`https://firestore.googleapis.com/v1/${DOCS}/sharedLessons?pageSize=300`, { headers: H });
const titles = ((await existing.json()).documents || []).map(d => d.fields.title.stringValue);
if (titles.includes(title)) { console.error(`Lesson "${title}" already exists (${titles.join(", ")}).`); process.exit(1); }

// Staggered createdAt keeps lesson and word order stable in the app.
const base = Date.now();
const lessonId = await createDoc("sharedLessons", {
  title: { stringValue: title },
  createdAt: { timestampValue: new Date(base).toISOString() },
});

let done = 0;
for (let i = 0; i < pairs.length; i += 20) {
  await Promise.all(pairs.slice(i, i + 20).map(([nl, fr], j) => createDoc("sharedWords", {
    nl: { stringValue: nl },
    fr: { stringValue: fr },
    lesson: { stringValue: lessonId },
    createdAt: { timestampValue: new Date(base + (i + j + 1) * 1000).toISOString() },
  }).then(() => { done++; })));
}
console.log(`Lesson "${title}" added with ${done}/${pairs.length} words — live for all users.`);
