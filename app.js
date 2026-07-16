// Zwart boekje — NL ↔ FR woordenlijst, opgeslagen in Firebase Firestore.
// Statisch, geen build-stap; Firebase SDK via CDN (ES modules).
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-app.js";
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut,
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-auth.js";
import {
  initializeFirestore, persistentLocalCache, collection, query, orderBy,
  onSnapshot, addDoc, deleteDoc, doc, serverTimestamp,
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import firebaseConfig from "./firebase-config.js";

const APP_VERSION = "0.1.0";
const $ = s => document.querySelector(s);
$("#version").textContent = "v" + APP_VERSION;

// Thema (zelfde aanpak als learn_words)
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

// Nog geen Firebase-config ingevuld -> uitleg tonen en stoppen.
if (firebaseConfig.projectId === "VUL-IN") {
  show("setup");
} else {
  start();
}

function start() {
  const app = initializeApp(firebaseConfig);
  const auth = getAuth(app);
  // Lokale cache: lijst is offline leesbaar en toevoegen wordt gebufferd
  // tot er weer verbinding is.
  const db = initializeFirestore(app, { localCache: persistentLocalCache() });
  const wordsCol = collection(db, "words");
  let words = [];          // [{id, nl, fr}] nieuwste eerst
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
      err => { $("#wordCount").textContent = "Fout: " + err.code; }
    );
  });

  // ---- inloggen ----
  $("#loginBtn").onclick = async () => {
    const errBox = $("#loginError");
    errBox.classList.add("hidden");
    try {
      await signInWithEmailAndPassword(auth, $("#loginEmail").value.trim(), $("#loginPass").value);
    } catch (e) {
      errBox.textContent = e.code === "auth/invalid-credential"
        ? "Onjuiste e-mail of wachtwoord." : "Inloggen mislukt (" + e.code + ").";
      errBox.classList.remove("hidden");
    }
  };
  $("#loginPass").addEventListener("keydown", e => { if (e.key === "Enter") $("#loginBtn").click(); });
  $("#logoutBtn").onclick = () => { if (confirm("Uitloggen op dit apparaat?")) signOut(auth); };

  // ---- toevoegen ----
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
    if (!nl || !fr) { feedback("Vul beide velden in.", false); return; }
    const dup = words.find(w =>
      w.nl.toLowerCase() === nl.toLowerCase() && w.fr.toLowerCase() === fr.toLowerCase());
    if (dup) { feedback("Staat al in het boekje.", false); return; }
    // Niet awaiten: offline blijft de write in de lokale wachtrij staan en de
    // Promise hangt tot er weer verbinding is — de UI moet gewoon doorgaan.
    addDoc(wordsCol, { nl, fr, createdAt: serverTimestamp() })
      .catch(e => feedback("Opslaan mislukt (" + e.code + ").", false));
    feedback(`✓ ${nl} — ${fr}`, true);
    $("#nlInput").value = ""; $("#frInput").value = "";
    $("#nlInput").focus();
  };
  $("#nlInput").addEventListener("keydown", e => { if (e.key === "Enter") $("#frInput").focus(); });
  $("#frInput").addEventListener("keydown", e => { if (e.key === "Enter") $("#addBtn").click(); });

  // ---- lijst ----
  $("#searchInput").oninput = renderList;

  function renderList() {
    const q = $("#searchInput").value.trim().toLowerCase();
    const shown = q
      ? words.filter(w => w.nl.toLowerCase().includes(q) || w.fr.toLowerCase().includes(q))
      : words;
    $("#wordCount").textContent = q
      ? `${shown.length} van ${words.length}`
      : `${words.length} ${words.length === 1 ? "woord" : "woorden"}`;
    $("#emptyMsg").classList.toggle("hidden", words.length > 0);
    const box = $("#wordList");
    box.innerHTML = "";
    shown.forEach(w => {
      const row = document.createElement("div");
      row.className = "ovrow";
      const nl = document.createElement("span"); nl.className = "ovnl"; nl.textContent = w.nl;
      const fr = document.createElement("span"); fr.className = "ovfr"; fr.textContent = w.fr;
      const del = document.createElement("button");
      del.className = "ovdel"; del.textContent = "✕"; del.title = "Verwijderen";
      del.onclick = () => {
        if (confirm(`"${w.nl} — ${w.fr}" verwijderen?`)) deleteDoc(doc(wordsCol, w.id));
      };
      row.append(nl, fr, del);
      box.appendChild(row);
    });
  }
}

if ("serviceWorker" in navigator)
  navigator.serviceWorker.register("sw.js", { updateViaCache: "none" }).catch(() => {});
