// Wordlist — per-account NL ↔ FR word lists with lessons and flashcards.
// Words + progress live in Firestore under users/{uid}/; flashcard engine
// ported from learn_words. Static, no build step; Firebase SDK via CDN.
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-app.js";
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword,
  createUserWithEmailAndPassword, sendPasswordResetEmail, signOut,
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-auth.js";
import {
  initializeFirestore, persistentLocalCache, collection, query, orderBy,
  onSnapshot, addDoc, deleteDoc, updateDoc, writeBatch, doc, serverTimestamp,
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import firebaseConfig from "./firebase-config.js";

const APP_VERSION = "0.4.0";
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

// ---- firebase --------------------------------------------------------------
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
// Local cache: everything stays readable offline and writes are queued
// until the connection is back.
const db = initializeFirestore(app, { localCache: persistentLocalCache() });

let uid = null;
let lessons = [];        // [{id, title}] in creation order
let words = [];          // [{id, nl, fr, lesson, learned, wrong}] newest first
let unsubs = [];

const lessonsCol = () => collection(db, "users", uid, "lessons");
const wordsCol   = () => collection(db, "users", uid, "words");
const lessonTitle = id => lessons.find(l => l.id === id)?.title || "?";

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
  if (!user) { uid = null; show("login"); return; }
  uid = user.uid;
  authMsg(null);
  show("notebook");
  unsubs.push(onSnapshot(query(lessonsCol(), orderBy("createdAt")), snap => {
    lessons = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    if (current >= lessons.length) current = 0;
    renderLessonSelects();
    if ($("#pick").classList.contains("hidden") === false) renderPick();
  }));
  unsubs.push(onSnapshot(query(wordsCol(), orderBy("createdAt", "desc")), snap => {
    words = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderList();
    if ($("#pick").classList.contains("hidden") === false) renderPick();
  }, err => { $("#wordCount").textContent = "Error: " + err.code; }));
});

// ---- lessons ----------------------------------------------------------------
async function newLesson() {
  const title = (prompt("Name for the new lesson:") || "").trim();
  if (!title) return null;
  const ref = await addDoc(lessonsCol(), { title, createdAt: serverTimestamp() });
  return ref.id;
}

function renderLessonSelects() {
  const add = $("#addLesson"); add.innerHTML = "";
  lessons.forEach(l => add.append(new Option(l.title, l.id)));
  add.append(new Option("＋ New lesson…", "__new"));
  const last = localStorage.getItem("lastLesson");
  if (lessons.some(l => l.id === last)) add.value = last;
  else if (lessons.length) add.value = lessons[lessons.length - 1].id;

  const filter = $("#filterLesson");
  const sel = filter.value;
  filter.innerHTML = "";
  filter.append(new Option("All lessons", ""));
  lessons.forEach(l => filter.append(new Option(l.title, l.id)));
  if ([...filter.options].some(o => o.value === sel)) filter.value = sel;
}
$("#addLesson").onchange = async e => {
  if (e.target.value !== "__new") { localStorage.setItem("lastLesson", e.target.value); return; }
  const id = await newLesson();          // snapshot re-renders the select
  if (id) localStorage.setItem("lastLesson", id);
  else e.target.value = localStorage.getItem("lastLesson") || "";
};

// ---- notebook: adding -------------------------------------------------------
let fbTimer = null;
function feedback(msg, ok) {
  const fb = $("#addFb");
  fb.textContent = msg;
  fb.style.color = ok ? "var(--done)" : "var(--bad)";
  fb.classList.remove("hidden");
  clearTimeout(fbTimer);
  fbTimer = setTimeout(() => fb.classList.add("hidden"), 2500);
}

$("#addBtn").onclick = async () => {
  const nl = $("#nlInput").value.trim();
  const fr = $("#frInput").value.trim();
  if (!nl || !fr) { feedback("Fill in both fields.", false); return; }
  let lesson = $("#addLesson").value;
  if (!lesson || lesson === "__new") {
    lesson = await newLesson();
    if (!lesson) { feedback("Create a lesson first.", false); return; }
    localStorage.setItem("lastLesson", lesson);
  }
  const dup = words.find(w => w.lesson === lesson &&
    w.nl.toLowerCase() === nl.toLowerCase() && w.fr.toLowerCase() === fr.toLowerCase());
  if (dup) { feedback("Already in this lesson.", false); return; }
  // Not awaited: offline, the write stays in the local queue and the
  // Promise hangs until the connection is back — the UI must move on.
  addDoc(wordsCol(), { nl, fr, lesson, learned: false, wrong: 0, createdAt: serverTimestamp() })
    .catch(e => feedback("Saving failed (" + e.code + ").", false));
  feedback(`✓ ${nl} — ${fr}`, true);
  $("#nlInput").value = ""; $("#frInput").value = "";
  $("#nlInput").focus();
};
$("#nlInput").addEventListener("keydown", e => { if (e.key === "Enter") $("#frInput").focus(); });
$("#frInput").addEventListener("keydown", e => { if (e.key === "Enter") $("#addBtn").click(); });

// ---- notebook: list + CSV export -------------------------------------------
$("#searchInput").oninput = renderList;
$("#filterLesson").onchange = renderList;

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
  $("#emptyMsg").classList.toggle("hidden", words.length > 0);
  const allLessons = !$("#filterLesson").value;
  const box = $("#wordList");
  box.innerHTML = "";
  shown.forEach(w => {
    const row = document.createElement("div");
    row.className = "ovrow";
    const nl = document.createElement("span"); nl.className = "ovnl"; nl.textContent = w.nl;
    const fr = document.createElement("span"); fr.className = "ovfr"; fr.textContent = w.fr;
    if (allLessons) {   // viewing everything: show which lesson a word is in
      const tag = document.createElement("span");
      tag.className = "count"; tag.textContent = lessonTitle(w.lesson);
      row.append(nl, fr, tag);
    } else {
      row.append(nl, fr);
    }
    const ok = document.createElement("span"); ok.className = "ovok";
    ok.textContent = w.learned ? "✓" : "";
    ok.title = w.learned ? "Learned" : "";
    const del = document.createElement("button");
    del.className = "ovdel"; del.textContent = "✕"; del.title = "Delete";
    del.onclick = () => {
      if (confirm(`Delete "${w.nl} — ${w.fr}"?`)) deleteDoc(doc(wordsCol(), w.id));
    };
    row.append(nl, fr, ok, del);
    box.appendChild(row);
  });
}

function csvField(s) {
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
$("#exportBtn").onclick = () => {
  const lesson = $("#filterLesson").value;
  const rows = ["nl,fr", ...shownWords().slice().reverse()  // oldest first
    .map(w => csvField(w.nl) + "," + csvField(w.fr))];
  // Leading BOM: learn_words reads utf-8-sig and Excel opens it correctly.
  const blob = new Blob(["\uFEFF" + rows.join("\n") + "\n"], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = (lesson ? lessonTitle(lesson) : "words") + ".csv";
  a.click();
  URL.revokeObjectURL(a.href);
};

// ---- progress (Firestore instead of learn_words' localStorage) --------------
function markLearned(id) {
  const w = words.find(x => x.id === id);
  if (w && w.learned) return;
  updateDoc(doc(wordsCol(), id), { learned: true }).catch(() => {});
}
// Per-card mistake counter: wrong -> +1, correct -> -1 (min 0).
// Cards with a positive count feed the "Tricky" session.
function bumpWrong(id, d) {
  const w = words.find(x => x.id === id);
  if (!w) return;
  const n = Math.max(0, (w.wrong || 0) + d);
  if (n !== (w.wrong || 0)) updateDoc(doc(wordsCol(), id), { wrong: n }).catch(() => {});
}
function lessonWords(lessonId) {
  return words.filter(w => w.lesson === lessonId).slice().reverse();  // oldest first
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

// ---- French TTS via the browser's speechSynthesis ---------------------------
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

// ---- type mode (answer by typing) — optional toggle, persisted --------------
let typeOn = localStorage.getItem("typemode") === "1";
function updateTypeBtn() { $("#typeToggle").classList.toggle("active", typeOn); }
$("#typeToggle").onclick = () => {
  typeOn = !typeOn; localStorage.setItem("typemode", typeOn ? "1" : "0"); updateTypeBtn();
};
updateTypeBtn();

// Lenient answer comparison for type mode.
function norm(s) {
  return s.toLowerCase().normalize("NFC").replace(/[’‘]/g, "'")
          .replace(/\s+/g, " ").replace(/[.!?\u2026\u00a0 ]+$/g, "").trim();
}
function deacc(s) { return s.normalize("NFD").replace(/[\u0300-\u036f]/g, ""); }

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ---- practice: lesson picker -------------------------------------------------
let current = 0;

function renderPick() {
  show("pick");
  const none = lessons.length === 0;
  $("#noLessons").classList.toggle("hidden", !none);
  ["#lessonSelect", "#pickCount", "#startNew", "#startAll", "#resetLesson",
   "#testBtn", "#weakBtn", "#typeToggle", "#testHint"]
    .forEach(s => $(s).classList.toggle("hidden", none));
  $(".bar").classList.toggle("hidden", none);
  if (none) return;

  const sel = $("#lessonSelect"); sel.innerHTML = "";
  lessons.forEach((l, i) => {
    const ws = lessonWords(l.id);
    const d = ws.filter(w => w.learned).length;
    sel.append(new Option(`Lesson ${l.title} — ${d}/${ws.length} learned`, i));
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
  if (!confirm(`Clear progress for lesson ${l.title}?`)) return;
  const batch = writeBatch(db);
  lessonWords(l.id).forEach(w => {
    if (w.learned) batch.update(doc(wordsCol(), w.id), { learned: false });
  });
  batch.commit().catch(() => {});
};

// ---- flashcard session --------------------------------------------------------
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
  $("#cardNl").textContent = card.nl;
  $("#cardFr").textContent = card.fr;
  $("#cardFr").classList.add("hidden");
  $("#typeFb").classList.add("hidden");
  $("#speakRow").classList.add("hidden");
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
  if (norm(guess) && norm(guess) === norm(card.fr)) {
    fb.textContent = "✓ Correct!"; fb.style.color = "var(--done)";
    $("#nextActions").classList.remove("hidden");
  } else if (norm(guess) && deacc(norm(guess)) === deacc(norm(card.fr))) {
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
  bumpWrong(card.id, good ? -1 : 1);
  if (good) {
    nGood++;
    if (!isTest) markLearned(card.id);   // test doesn't count
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
    $("#doneDetail").textContent = `Lesson ${l.title}: ${d} / ${ws.length} learned`;
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
