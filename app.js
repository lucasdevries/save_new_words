// Wordlist — shared NL ↔ FR lessons + a personal notebook, with flashcards.
// Shared curriculum lives in sharedLessons/sharedWords (read-only for
// everyone, maintained by the admin account); each user's own words live in
// users/{uid}/words and their progress over the shared lessons in
// users/{uid}/progress. Flashcard engine ported from learn_words.
// Static, no build step; Firebase SDK via CDN.
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-app.js";
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword,
  createUserWithEmailAndPassword, sendPasswordResetEmail, signOut,
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-auth.js";
import {
  initializeFirestore, persistentLocalCache, collection, query, orderBy,
  onSnapshot, addDoc, deleteDoc, updateDoc, setDoc, writeBatch, doc,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import firebaseConfig from "./firebase-config.js";

const APP_VERSION = "0.6.0";
const NOTEBOOK = "__notebook";   // pseudo-lesson id for the personal notebook
const $ = s => document.querySelector(s);
$("#version").textContent = "v" + APP_VERSION;

// ---- theme (same approach as learn_words) ---------------------------------
function applyTheme(t) {
  document.documentElement.setAttribute("data-theme", t);
  $("#themeToggle").textContent = t === "dark" ? "☀️" : "🌙";
}
applyTheme(localStorage.getItem("theme") || "light");
$("#themeToggle").onclick = () => {
  const next = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
  localStorage.setItem("theme", next); applyTheme(next);
};

// ---- firebase ---------------------------------------------------------------
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
// Local cache: everything stays readable offline and writes are queued
// until the connection is back.
const db = initializeFirestore(app, { localCache: persistentLocalCache() });

let uid = null;
let sharedLessons = [];  // [{id, title}] in creation order
let sharedWords = [];    // [{id, nl, fr, lesson, createdAt}] oldest first
let myWords = [];        // [{id, nl, fr, learned, wrong, createdAt}] newest first
let progress = {};       // sharedWordId -> {learned, wrong}
let lessons = [];        // view: shared lessons + the notebook pseudo-lesson
let words = [];          // view: all words with lesson/learned/wrong resolved
let unsubs = [];

const myWordsCol  = () => collection(db, "users", uid, "words");
const progressRef = id => doc(db, "users", uid, "progress", id);
const lessonTitle = id => lessons.find(l => l.id === id)?.title || "?";

function rebuildView() {
  lessons = [...sharedLessons, { id: NOTEBOOK, title: "notebook", personal: true }];
  if (current >= lessons.length) current = 0;
  words = [
    ...sharedWords.map(w => ({
      ...w, personal: false,
      learned: !!progress[w.id]?.learned,
      wrong: progress[w.id]?.wrong || 0,
    })),
    ...myWords.map(w => ({
      ...w, personal: true, lesson: NOTEBOOK,
      learned: !!w.learned, wrong: w.wrong || 0,
    })),
  ];
  renderLessonSelects();
  renderList();
  if (!$("#pick").classList.contains("hidden")) renderPick();
}

// ---- screens ----------------------------------------------------------------
// Two levels: login vs app, and within the app the sub-screens. The notebook
// tab owns "notebook"; the practice tab owns pick/session/done.
function show(id) {
  ["login", "app"].forEach(s => $("#" + s).classList.toggle("hidden", s !== (id === "login" ? "login" : "app")));
  if (id === "login") return;
  ["notebook", "pick", "session", "done"].forEach(s => $("#" + s).classList.toggle("hidden", s !== id));
  $("#tabNotebook").classList.toggle("active", id === "notebook");
  $("#tabPractice").classList.toggle("active", id !== "notebook");
}
$("#tabNotebook").onclick = () => show("notebook");
$("#tabPractice").onclick = () => { renderPick(); };

// ---- auth -------------------------------------------------------------------
function authMsg(el, msg) {
  ["#loginError", "#loginInfo"].forEach(s => $(s).classList.add("hidden"));
  if (msg) { $(el).textContent = msg; $(el).classList.remove("hidden"); }
}
const AUTH_ERRORS = {
  "auth/invalid-credential": "Wrong email or password.",
  "auth/invalid-email": "That is not a valid email address.",
  "auth/email-already-in-use": "That email already has an account — log in instead.",
  "auth/weak-password": "Password too weak (at least 6 characters).",
  "auth/missing-password": "Fill in a password.",
};
const authError = e => AUTH_ERRORS[e.code] || "Failed (" + e.code + ").";

$("#loginBtn").onclick = async () => {
  try { await signInWithEmailAndPassword(auth, $("#loginEmail").value.trim(), $("#loginPass").value); }
  catch (e) { authMsg("#loginError", authError(e)); }
};
$("#signupBtn").onclick = async () => {
  try { await createUserWithEmailAndPassword(auth, $("#loginEmail").value.trim(), $("#loginPass").value); }
  catch (e) { authMsg("#loginError", authError(e)); }
};
$("#resetBtn").onclick = async () => {
  const email = $("#loginEmail").value.trim();
  if (!email) { authMsg("#loginError", "Fill in your email first."); return; }
  try {
    await sendPasswordResetEmail(auth, email);
    authMsg("#loginInfo", "Reset email sent — check your inbox.");
  } catch (e) { authMsg("#loginError", authError(e)); }
};
$("#loginPass").addEventListener("keydown", e => { if (e.key === "Enter") $("#loginBtn").click(); });
$("#logoutBtn").onclick = () => { if (confirm("Log out on this device?")) signOut(auth); };

onAuthStateChanged(auth, user => {
  unsubs.forEach(u => u()); unsubs = [];
  if (!user) {
    uid = null;
    sharedLessons = []; sharedWords = []; myWords = []; progress = {};
    show("login");
    return;
  }
  uid = user.uid;
  authMsg(null);
  show("notebook");
  unsubs.push(onSnapshot(query(collection(db, "sharedLessons"), orderBy("createdAt")), snap => {
    sharedLessons = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    rebuildView();
  }));
  unsubs.push(onSnapshot(query(collection(db, "sharedWords"), orderBy("createdAt")), snap => {
    sharedWords = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    rebuildView();
  }));
  unsubs.push(onSnapshot(query(myWordsCol(), orderBy("createdAt", "desc")), snap => {
    myWords = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    rebuildView();
  }, err => { $("#wordCount").textContent = "Error: " + err.code; }));
  unsubs.push(onSnapshot(collection(db, "users", uid, "progress"), snap => {
    progress = Object.fromEntries(snap.docs.map(d => [d.id, d.data()]));
    rebuildView();
  }));
});

// ---- notebook: adding (always to the personal notebook) ----------------------
let fbTimer = null;
function feedback(msg, ok) {
  const fb = $("#addFb");
  fb.textContent = msg;
  fb.style.color = ok ? "var(--done)" : "var(--bad)";
  fb.classList.remove("hidden");
  clearTimeout(fbTimer);
  fbTimer = setTimeout(() => fb.classList.add("hidden"), 2500);
}

$("#addBtn").onclick = () => {
  const nl = $("#nlInput").value.trim();
  const fr = $("#frInput").value.trim();
  if (!nl || !fr) { feedback("Fill in both fields.", false); return; }
  const dup = myWords.find(w =>
    w.nl.toLowerCase() === nl.toLowerCase() && w.fr.toLowerCase() === fr.toLowerCase());
  if (dup) { feedback("Already in your notebook.", false); return; }
  // Not awaited: offline, the write stays in the local queue and the
  // Promise hangs until the connection is back — the UI must move on.
  addDoc(myWordsCol(), { nl, fr, learned: false, wrong: 0, createdAt: serverTimestamp() })
    .catch(e => feedback("Saving failed (" + e.code + ").", false));
  feedback(`✓ ${nl} — ${fr}`, true);
  $("#nlInput").value = ""; $("#frInput").value = "";
  $("#nlInput").focus();
};
$("#nlInput").addEventListener("keydown", e => { if (e.key === "Enter") $("#frInput").focus(); });
$("#frInput").addEventListener("keydown", e => { if (e.key === "Enter") $("#addBtn").click(); });

// ---- notebook: list + CSV export ---------------------------------------------
$("#searchInput").oninput = renderList;
$("#filterLesson").onchange = renderList;

function renderLessonSelects() {
  const filter = $("#filterLesson");
  const sel = filter.value;
  filter.innerHTML = "";
  filter.append(new Option("All lessons", ""));
  lessons.forEach(l => filter.append(new Option(l.personal ? "📓 my notebook" : l.title, l.id)));
  filter.value = [...filter.options].some(o => o.value === sel) ? sel : NOTEBOOK;
}

function shownWords() {
  const q = $("#searchInput").value.trim().toLowerCase();
  const lesson = $("#filterLesson").value;
  return words
    .filter(w => !lesson || w.lesson === lesson)
    .filter(w => !q || w.nl.toLowerCase().includes(q) || w.fr.toLowerCase().includes(q));
}

function renderList() {
  if (!uid) return;
  const shown = shownWords();
  $("#wordCount").textContent = shown.length === words.length
    ? `${words.length} ${words.length === 1 ? "word" : "words"}`
    : `${shown.length} of ${words.length}`;
  $("#emptyMsg").classList.toggle("hidden",
    !($("#filterLesson").value === NOTEBOOK && myWords.length === 0));
  const allLessons = !$("#filterLesson").value;
  const box = $("#wordList");
  box.innerHTML = "";
  shown.forEach(w => {
    const row = document.createElement("div");
    row.className = "ovrow";
    const nl = document.createElement("span"); nl.className = "ovnl"; nl.textContent = w.nl;
    const fr = document.createElement("span"); fr.className = "ovfr"; fr.textContent = w.fr;
    row.append(nl, fr);
    if (allLessons) {   // viewing everything: show which lesson a word is in
      const tag = document.createElement("span");
      tag.className = "count"; tag.textContent = w.personal ? "📓" : lessonTitle(w.lesson);
      row.append(tag);
    }
    const ok = document.createElement("span"); ok.className = "ovok";
    ok.textContent = w.learned ? "✓" : "";
    row.append(ok);
    if (w.personal) {   // only your own notebook words can be deleted
      const del = document.createElement("button");
      del.className = "ovdel"; del.textContent = "✕"; del.title = "Delete";
      del.onclick = () => {
        if (confirm(`Delete "${w.nl} — ${w.fr}"?`)) deleteDoc(doc(myWordsCol(), w.id));
      };
      row.append(del);
    }
    box.appendChild(row);
  });
}

function csvField(s) {
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
$("#exportBtn").onclick = () => {
  const lesson = $("#filterLesson").value;
  const sorted = shownWords().slice()
    .sort((a, b) => (a.createdAt?.seconds || 0) - (b.createdAt?.seconds || 0));  // oldest first
  const rows = ["nl,fr", ...sorted.map(w => csvField(w.nl) + "," + csvField(w.fr))];
  // Leading BOM: learn_words reads utf-8-sig and Excel opens it correctly.
  const blob = new Blob(["\uFEFF" + rows.join("\n") + "\n"], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = (lesson === NOTEBOOK ? "notebook" : lesson ? lessonTitle(lesson) : "words") + ".csv";
  a.click();
  URL.revokeObjectURL(a.href);
};

// ---- progress (per user; on the word doc for notebook words, in
// users/{uid}/progress for shared words) ---------------------------------------
function markLearned(w) {
  if (w.personal) updateDoc(doc(myWordsCol(), w.id), { learned: true }).catch(() => {});
  else setDoc(progressRef(w.id), { learned: true }, { merge: true }).catch(() => {});
}
// Per-card mistake counter: wrong -> +1, correct -> -1 (min 0).
// Cards with a positive count feed the "Tricky" session.
function bumpWrong(w, d) {
  const cur = words.find(x => x.id === w.id && x.personal === w.personal);
  const n = Math.max(0, (cur?.wrong || 0) + d);
  if (n === (cur?.wrong || 0)) return;
  if (w.personal) updateDoc(doc(myWordsCol(), w.id), { wrong: n }).catch(() => {});
  else setDoc(progressRef(w.id), { wrong: n }, { merge: true }).catch(() => {});
}
function lessonWords(lessonId) {
  const ws = words.filter(w => w.lesson === lessonId);
  return lessonId === NOTEBOOK ? ws.slice().reverse() : ws;  // oldest first
}
function weakPool() {
  return words.filter(w => w.wrong > 0).slice().sort((a, b) => b.wrong - a.wrong);
}
// Lessons at >=80% learned supply the test pool.
function testPool() {
  const cards = [], names = [];
  lessons.forEach(l => {
    const ws = lessonWords(l.id);
    const d = ws.filter(w => w.learned).length;
    if (ws.length && d / ws.length >= 0.8) { names.push(l.title); cards.push(...ws); }
  });
  return { cards, lessons: names };
}

// ---- French TTS via the browser's speechSynthesis -----------------------------
// (works on iPhone too; needs a tap to start — the 🔊 button — and the mute
// switch silences it)
let frVoice = null;
const hasTTS = "speechSynthesis" in window;
function pickVoice() {
  const vs = speechSynthesis.getVoices();
  frVoice = vs.find(v => v.lang === "fr-FR") || vs.find(v => v.lang.startsWith("fr")) || null;
}
if (hasTTS) { pickVoice(); speechSynthesis.onvoiceschanged = pickVoice; }
function speak(text) {
  if (!hasTTS) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = "fr-FR"; if (frVoice) u.voice = frVoice; u.rate = 0.9;
  speechSynthesis.speak(u);
}
$("#speakBtn").onclick = () => { if (card) speak(card.fr); };

// ---- practice direction (NL → FR or FR → NL) — persisted ----------------------
let dir = localStorage.getItem("direction") === "frnl" ? "frnl" : "nlfr";
const promptOf = w => dir === "nlfr" ? w.nl : w.fr;
const answerOf = w => dir === "nlfr" ? w.fr : w.nl;
function updateDirBtn() {
  $("#dirToggle").textContent = dir === "nlfr" ? "🇳🇱 → 🇫🇷" : "🇫🇷 → 🇳🇱";
  $("#typeInput").placeholder =
    dir === "nlfr" ? "Type the French translation…" : "Type the Dutch translation…";
}
$("#dirToggle").onclick = () => {
  dir = dir === "nlfr" ? "frnl" : "nlfr";
  localStorage.setItem("direction", dir);
  updateDirBtn();
};
updateDirBtn();

// ---- type mode (answer by typing) — optional toggle, persisted ----------------
let typeOn = localStorage.getItem("typemode") === "1";
function updateTypeBtn() { $("#typeToggle").classList.toggle("active", typeOn); }
$("#typeToggle").onclick = () => {
  typeOn = !typeOn; localStorage.setItem("typemode", typeOn ? "1" : "0"); updateTypeBtn();
};
updateTypeBtn();

// Lenient answer comparison for type mode.
function norm(s) {
  return s.toLowerCase().normalize("NFC").replace(/[’‘]/g, "'")
          .replace(/\s+/g, " ").replace(/[.!?…  ]+$/g, "").trim();
}
function deacc(s) { return s.normalize("NFD").replace(/[\u0300-\u036f]/g, ""); }

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ---- practice: lesson picker ---------------------------------------------------
let current = 0;

function renderPick() {
  show("pick");
  const none = lessons.length === 0;
  $("#noLessons").classList.toggle("hidden", !none);
  ["#lessonSelect", "#pickCount", "#startNew", "#startAll", "#resetLesson",
   "#testBtn", "#weakBtn", "#typeToggle", "#dirToggle", "#testHint"]
    .forEach(s => $(s).classList.toggle("hidden", none));
  $(".bar").classList.toggle("hidden", none);
  if (none) return;

  const sel = $("#lessonSelect"); sel.innerHTML = "";
  lessons.forEach((l, i) => {
    const ws = lessonWords(l.id);
    const d = ws.filter(w => w.learned).length;
    const name = l.personal ? "📓 my notebook" : `Lesson ${l.title}`;
    sel.append(new Option(`${name} — ${d}/${ws.length} learned`, i));
  });
  sel.value = current;

  const l = lessons[current];
  const ws = lessonWords(l.id);
  const d = ws.filter(w => w.learned).length;
  const fresh = ws.length - d;
  $("#pickCount").textContent = `${d} / ${ws.length} learned`;
  $("#pickBar").style.width = (ws.length ? (100 * d / ws.length) : 0) + "%";
  $("#startNew").textContent = `Start new (${fresh})`;
  $("#startNew").disabled = fresh === 0;
  $("#startAll").textContent = `Start all (${ws.length})`;
  $("#startAll").disabled = ws.length === 0;
  const pool = testPool();
  $("#testBtn").disabled = pool.cards.length === 0;
  $("#testHint").textContent = pool.lessons.length
    ? `from ${pool.lessons.length} lesson${pool.lessons.length === 1 ? "" : "s"} at 80%+ (${pool.lessons.join(", ")})`
    : "no lesson at 80%+ yet";
  const weak = weakPool();
  $("#weakBtn").textContent = `Tricky (${Math.min(weak.length, 20)})`;
  $("#weakBtn").disabled = weak.length === 0;
}
$("#lessonSelect").onchange = e => { current = +e.target.value; renderPick(); };

$("#resetLesson").onclick = () => {
  const l = lessons[current];
  if (!l) return;
  if (!confirm(`Clear your progress for ${l.personal ? "your notebook" : "lesson " + l.title}?`)) return;
  const batch = writeBatch(db);
  lessonWords(l.id).forEach(w => {
    if (!w.learned) return;
    if (w.personal) batch.update(doc(myWordsCol(), w.id), { learned: false });
    else batch.set(progressRef(w.id), { learned: false }, { merge: true });
  });
  batch.commit().catch(() => {});
};

// ---- flashcard session ----------------------------------------------------------
let queue = [], retryQueue = [], card = null, revealed = false;
let inRetry = false, isTest = false, roundTotal = 0, roundDone = 0, nGood = 0, nBad = 0, lastMode = "new";

function startSession(mode) {
  isTest = mode === "test";
  let cards;
  if (isTest) {
    cards = shuffle(testPool().cards.slice()).slice(0, 25);
  } else if (mode === "weak") {
    cards = weakPool().slice(0, 20);       // most mistakes first, max 20 per session
  } else {
    const l = lessons[current];
    if (!l) return;
    const ws = lessonWords(l.id);
    cards = mode === "new" ? ws.filter(w => !w.learned) : ws;
  }
  if (!cards.length) return;
  lastMode = mode;
  queue = shuffle(cards.slice());
  retryQueue = [];
  inRetry = false; roundTotal = queue.length; roundDone = 0; nGood = 0; nBad = 0;
  $("#retryBanner").classList.add("hidden");
  $("#testBanner").classList.toggle("hidden", !isTest);
  show("session");
  nextCard();
}
$("#startNew").onclick = () => startSession("new");
$("#startAll").onclick = () => startSession("all");
$("#testBtn").onclick = () => startSession("test");
$("#weakBtn").onclick = () => startSession("weak");
$("#stopBtn").onclick = () => renderPick();

function nextCard() {
  if (!queue.length) {
    if (!isTest && !inRetry && retryQueue.length) {   // retry round at the end
      inRetry = true;
      queue = shuffle(retryQueue.slice()); retryQueue = [];
      roundTotal = queue.length; roundDone = 0;
      $("#retryBanner").classList.remove("hidden");
    } else {
      return endSession();
    }
  }
  card = queue.shift(); revealed = false; roundDone++;
  $("#sessCount").textContent = `${roundDone} / ${roundTotal}`;
  $("#cardNl").textContent = promptOf(card);
  $("#cardFr").textContent = answerOf(card);
  $("#cardFr").classList.add("hidden");
  $("#typeFb").classList.add("hidden");
  // FR → NL: the French is the visible prompt, so it can be spoken right away.
  $("#speakRow").classList.toggle("hidden", !(hasTTS && dir === "frnl"));
  $("#judgeActions").classList.add("hidden");
  $("#nextActions").classList.add("hidden");
  $("#goodBtn").textContent = "✓ Correct";
  $("#showActions").classList.toggle("hidden", typeOn);
  $("#typeActions").classList.toggle("hidden", !typeOn);
  if (typeOn) { const inp = $("#typeInput"); inp.value = ""; inp.focus(); }
  $("#kbHint").textContent = typeOn ? "enter = check" : "space = show · ← = wrong · → = correct";
}

function showAnswer() {
  $("#cardFr").classList.remove("hidden");
  if (hasTTS) $("#speakRow").classList.remove("hidden");
}

function reveal() {
  if (revealed) return;
  revealed = true;
  showAnswer();
  $("#showActions").classList.add("hidden");
  $("#judgeActions").classList.remove("hidden");
}
$("#showBtn").onclick = reveal;

// Type mode: compare the typed answer; only accent mistakes still count as good.
function check() {
  if (revealed) return;
  revealed = true;
  const guess = $("#typeInput").value;
  showAnswer();
  $("#typeActions").classList.add("hidden");
  const fb = $("#typeFb");
  fb.classList.remove("hidden");
  if (norm(guess) && norm(guess) === norm(answerOf(card))) {
    fb.textContent = "✓ Correct!"; fb.style.color = "var(--done)";
    $("#nextActions").classList.remove("hidden");
  } else if (norm(guess) && deacc(norm(guess)) === deacc(norm(answerOf(card)))) {
    fb.textContent = "≈ Almost — mind the accents"; fb.style.color = "var(--done)";
    $("#nextActions").classList.remove("hidden");
  } else {
    fb.textContent = norm(guess) ? `You typed: ${guess}` : "No answer";
    fb.style.color = "var(--bad)";
    $("#goodBtn").textContent = "✓ Count it correct";
    $("#judgeActions").classList.remove("hidden");
  }
}
$("#checkBtn").onclick = check;
$("#nextBtn").onclick = () => judge(true);

function judge(good) {
  if (!revealed) return;
  bumpWrong(card, good ? -1 : 1);
  if (good) {
    nGood++;
    if (!isTest) markLearned(card);   // test doesn't count
  } else {
    nBad++;
    if (!isTest && !inRetry) retryQueue.push(card);
  }
  nextCard();
}
$("#goodBtn").onclick = () => judge(true);
$("#badBtn").onclick = () => judge(false);

function endSession() {
  if (isTest) {
    const pct = Math.round(100 * nGood / roundTotal);
    $("#doneSummary").textContent = `${pct >= 80 ? "🎉 " : ""}Test: ${nGood} / ${roundTotal} correct — ${pct}%`;
    $("#doneDetail").textContent = "doesn't count towards progress";
  } else if (lastMode === "weak") {
    const left = weakPool().length;
    $("#doneSummary").textContent = nBad === 0 ? "🎉 All correct!" : `Done — ${nGood} correct, ${nBad} wrong`;
    $("#doneDetail").textContent = left ? `${left} tricky cards left` : "no tricky cards left 💪";
  } else {
    const l = lessons[current];
    const ws = lessonWords(l.id);
    const d = ws.filter(w => w.learned).length;
    $("#doneSummary").textContent = nBad === 0 ? "🎉 All correct!" : `Done — ${nGood} correct, ${nBad} wrong`;
    $("#doneDetail").textContent = `${l.personal ? "Notebook" : "Lesson " + l.title}: ${d} / ${ws.length} learned`;
  }
  show("done");
}
$("#againBtn").onclick = () => startSession(lastMode);
$("#backBtn").onclick = () => renderPick();

document.addEventListener("keydown", e => {
  if ($("#session").classList.contains("hidden")) return;
  if (e.target === $("#typeInput")) {            // typing: only capture enter
    if (e.key === "Enter") { e.preventDefault(); check(); }
    return;
  }
  if (e.key === "Enter" && !$("#nextActions").classList.contains("hidden")) { judge(true); return; }
  if (e.key === " ") { e.preventDefault(); if (!typeOn) reveal(); }
  else if (e.key === "ArrowRight") judge(true);
  else if (e.key === "ArrowLeft") judge(false);
});

if ("serviceWorker" in navigator)
  navigator.serviceWorker.register("sw.js", { updateViaCache: "none" }).catch(() => {});
