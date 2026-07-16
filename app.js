// Wordlist — NL ↔ FR word list, stored in Firebase Firestore.
// Static, no build step; Firebase SDK via CDN (ES modules).
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-app.js";
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut,
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-auth.js";
import {
  initializeFirestore, persistentLocalCache, collection, query, orderBy,
  onSnapshot, addDoc, deleteDoc, doc, serverTimestamp,
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import firebaseConfig from "./firebase-config.js";

const APP_VERSION = "0.3.0";
const $ = s => document.querySelector(s);
$("#version").textContent = "v" + APP_VERSION;

// Theme (same approach as learn_words)
function applyTheme(t) {
  document.documentElement.setAttribute("data-theme", t);
  $("#themeToggle").textContent = t === "dark" ? "☀️" : "🌙";
}
applyTheme(localStorage.getItem("theme") || "light");
$("#themeToggle").onclick = () => {
  const next = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
  localStorage.setItem("theme", next); applyTheme(next);
};

function show(id) {
  ["setup", "login", "main"].forEach(s => $("#" + s).classList.toggle("hidden", s !== id));
}

// Firebase config not filled in yet -> show the setup notice and stop.
if (firebaseConfig.projectId === "FILL-IN") {
  show("setup");
} else {
  start();
}

function start() {
  const app = initializeApp(firebaseConfig);
  const auth = getAuth(app);
  // Local cache: the list stays readable offline and adds are buffered
  // until the connection is back.
  const db = initializeFirestore(app, { localCache: persistentLocalCache() });
  const wordsCol = collection(db, "words");
  let words = [];          // [{id, nl, fr}] newest first
  let unsubscribe = null;

  onAuthStateChanged(auth, user => {
    if (!user) {
      if (unsubscribe) { unsubscribe(); unsubscribe = null; }
      show("login");
      return;
    }
    show("main");
    $("#nlInput").focus();
    unsubscribe = onSnapshot(
      query(wordsCol, orderBy("createdAt", "desc")),
      snap => {
        words = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        renderList();
      },
      err => { $("#wordCount").textContent = "Error: " + err.code; }
    );
  });

  // ---- login ----
  $("#loginBtn").onclick = async () => {
    const errBox = $("#loginError");
    errBox.classList.add("hidden");
    try {
      await signInWithEmailAndPassword(auth, $("#loginEmail").value.trim(), $("#loginPass").value);
    } catch (e) {
      errBox.textContent = e.code === "auth/invalid-credential"
        ? "Wrong email or password." : "Login failed (" + e.code + ").";
      errBox.classList.remove("hidden");
    }
  };
  $("#loginPass").addEventListener("keydown", e => { if (e.key === "Enter") $("#loginBtn").click(); });
  $("#logoutBtn").onclick = () => { if (confirm("Log out on this device?")) signOut(auth); };

  // ---- adding ----
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
    const dup = words.find(w =>
      w.nl.toLowerCase() === nl.toLowerCase() && w.fr.toLowerCase() === fr.toLowerCase());
    if (dup) { feedback("Already in the list.", false); return; }
    // Not awaited: offline, the write stays in the local queue and the
    // Promise hangs until the connection is back — the UI must move on.
    addDoc(wordsCol, { nl, fr, createdAt: serverTimestamp() })
      .catch(e => feedback("Saving failed (" + e.code + ").", false));
    feedback(`✓ ${nl} — ${fr}`, true);
    $("#nlInput").value = ""; $("#frInput").value = "";
    $("#nlInput").focus();
  };
  $("#nlInput").addEventListener("keydown", e => { if (e.key === "Enter") $("#frInput").focus(); });
  $("#frInput").addEventListener("keydown", e => { if (e.key === "Enter") $("#addBtn").click(); });

  // ---- CSV export (learn_words format: header nl,fr) ----
  function csvField(s) {
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  $("#exportBtn").onclick = () => {
    const rows = ["nl,fr", ...words.slice().reverse()  // oldest first
      .map(w => csvField(w.nl) + "," + csvField(w.fr))];
    // Leading BOM: learn_words reads utf-8-sig and Excel opens it correctly.
    const blob = new Blob(["\uFEFF" + rows.join("\n") + "\n"], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "words.csv";
    a.click();
    URL.revokeObjectURL(a.href);
  };

  // ---- list ----
  $("#searchInput").oninput = renderList;

  function renderList() {
    const q = $("#searchInput").value.trim().toLowerCase();
    const shown = q
      ? words.filter(w => w.nl.toLowerCase().includes(q) || w.fr.toLowerCase().includes(q))
      : words;
    $("#wordCount").textContent = q
      ? `${shown.length} of ${words.length}`
      : `${words.length} ${words.length === 1 ? "word" : "words"}`;
    $("#emptyMsg").classList.toggle("hidden", words.length > 0);
    const box = $("#wordList");
    box.innerHTML = "";
    shown.forEach(w => {
      const row = document.createElement("div");
      row.className = "ovrow";
      const nl = document.createElement("span"); nl.className = "ovnl"; nl.textContent = w.nl;
      const fr = document.createElement("span"); fr.className = "ovfr"; fr.textContent = w.fr;
      const del = document.createElement("button");
      del.className = "ovdel"; del.textContent = "✕"; del.title = "Delete";
      del.onclick = () => {
        if (confirm(`Delete "${w.nl} — ${w.fr}"?`)) deleteDoc(doc(wordsCol, w.id));
      };
      row.append(nl, fr, del);
      box.appendChild(row);
    });
  }
}

if ("serviceWorker" in navigator)
  navigator.serviceWorker.register("sw.js", { updateViaCache: "none" }).catch(() => {});
