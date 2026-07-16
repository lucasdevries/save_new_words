# Wordlist 📓

A personal NL ↔ FR word notebook with built-in flashcards. Everyone creates
their own account and gets their own wordlist, organised in lessons:

- **Notebook**: type a word pair, tap **Add** — stored in a free Firebase
  database (Firestore), searchable, exportable as CSV.
- **Practice**: flashcard sessions per lesson (ported from
  [learn_words](../learn_words)) — start new/all, a retry round for mistakes,
  a 25-card test across lessons at 80%+, a "Tricky" session for your most
  missed cards, type-the-answer mode and French pronunciation.

Progress lives in the cloud, not on the device: log in on a new phone and
everything is there. Works as a PWA and is usable offline (changes sync when
the connection is back). Hosted on GitHub Pages like
[julius-km-registratie](https://github.com/lucasdevries/kilometerregistratie).

## One-time setup

### 1. Firebase project (the "backend") — ±5 minutes

> ⚠️ **On a work laptop:** do this in an **incognito/private window** and sign
> in with your **personal** Google account, so the project is never tied to a
> work account.

1. Go to [console.firebase.google.com](https://console.firebase.google.com)
   and sign in with your personal account.
2. **Add project** → name e.g. `save-new-words` → Google Analytics **off** → create.
3. **Build → Firestore Database → Create database** → location `eur3 (europe-west)`
   → **production mode**.
4. **Rules** tab: replace the contents with [`firestore.rules`](firestore.rules)
   and click **Publish**. (Each account can then only touch its own data.)
5. **Build → Authentication → Get started** → **Email/Password** → enable only
   "Email/Password" → Save. Sign-ups stay enabled so people can create their
   own account from the login screen.
6. **Settings → Authorized domains**: add `lucasdevries.github.io`
   (localhost is already there).
7. Go to **Project Overview → ⚙ Project settings → Your apps → `</>` (web)**,
   register an app (name doesn't matter, no hosting needed) and copy the
   `firebaseConfig` object into [`firebase-config.js`](firebase-config.js) in
   this repo. These values are not secret and can simply be committed.

### 2. Hosting the app

The app is a static page; GitHub Pages is free and sufficient:

```sh
git init && git add -A && git commit -m "Wordlist"
gh repo create save_new_words --public --source=. --push
gh api repos/{owner}/save_new_words/pages -X POST \
  -f 'source[branch]=main' -f 'source[path]=/'
```

The app then lives at `https://<username>.github.io/save_new_words/`
(this instance: https://lucasdevries.github.io/save_new_words/).
Test locally: `python3 -m http.server 8000` → http://localhost:8000.

### 3. On the phone

1. Open the URL in Safari (iPhone) or Chrome (Android).
2. **Share → Add to Home Screen** — the app then works as a standalone app.
3. Log in once (or create an account); it is remembered.

## How it works

- **Data model**: everything is per account. `users/{uid}/lessons/{id}` holds
  the lesson names; `users/{uid}/words/{id}` holds `nl`, `fr`, the lesson it
  belongs to, and the learning progress (`learned`, `wrong`) right on the word
  document. The free Spark plan handles this with ease.
- **Flashcards**: same behaviour as learn_words — "Start new" quizzes the
  not-yet-learned words, mistakes get a retry round, the mistake counter feeds
  the "Tricky" session, and lessons at 80%+ supply the test pool. Marking a
  card correct outside a test sets `learned`.
- **Live sync**: the app listens in realtime (`onSnapshot`), so a second
  device logged into the same account updates immediately.
- **CSV export**: the ⬇ CSV button downloads the current lesson filter as
  `<lesson>.csv` (header `nl,fr`, oldest first) — the exact format of
  `learn_words/lists/`.
- **Offline**: Firestore caches locally; anything done offline syncs later.
- **Security**: Firestore rules restrict every account to its own
  `users/{uid}/` subtree. The Firebase config in the repo is deliberately
  public — that is standard for Firebase web apps.
