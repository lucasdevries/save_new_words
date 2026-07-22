#!/usr/bin/env node
// Import speak (shadowing) lessons from the learn_french repo into speak/.
// Reads every lessons/<slug>/lesson.json, copies the per-sentence clips to
// speak/media/<slug>/NNN.m4a and rewrites speak/lessons.json. Idempotent:
// run it again after new lessons appear in learn_french, then commit.
//
//   node scripts/add_speak_lessons.mjs [path-to-learn_french-lessons-dir]
//
// Only the sentence clips are copied (not the full audio.m4a) and only the
// nl translation is kept — the app is FR -> NL only.
import { readdirSync, readFileSync, writeFileSync, mkdirSync, copyFileSync,
         existsSync, statSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const src = resolve(process.argv[2] || join(root, "..", "learn_french", "lessons"));
if (!existsSync(src)) {
  console.error("Lessons dir not found: " + src);
  process.exit(1);
}
const srcBase = dirname(src);   // clip paths in lesson.json are relative to this

const lessons = [];
let copied = 0, kept = 0;
for (const slug of readdirSync(src).sort()) {
  const metaPath = join(src, slug, "lesson.json");
  if (!existsSync(metaPath)) continue;
  const meta = JSON.parse(readFileSync(metaPath, "utf8"));
  const sentences = [];
  (meta.sentences || []).forEach((s, i) => {
    if (!s.text) return;
    let clip = null;
    const srcClip = s.clip && resolve(srcBase, s.clip);
    if (srcClip && existsSync(srcClip)) {
      const name = String(i).padStart(3, "0") + ".m4a";
      const dstDir = join(root, "speak", "media", slug);
      const dst = join(dstDir, name);
      mkdirSync(dstDir, { recursive: true });
      if (existsSync(dst) && statSync(dst).size === statSync(srcClip).size) {
        kept++;
      } else {
        copyFileSync(srcClip, dst);
        copied++;
      }
      clip = ["speak", "media", slug, name].join("/");
    }
    sentences.push({ text: s.text, nl: s.tr?.nl || "", clip });
  });
  if (sentences.length) lessons.push({ slug, title: meta.title || slug, sentences });
}

writeFileSync(join(root, "speak", "lessons.json"), JSON.stringify(lessons));
const total = lessons.reduce((n, l) => n + l.sentences.length, 0);
console.log(`speak/lessons.json — ${lessons.length} lessons, ${total} sentences ` +
            `(${copied} clips copied, ${kept} already up to date)`);
