# Wordlist 📓

A tiny shared notebook for NL ↔ FR words: type a word pair, tap **Add**, and it
is stored in a free Firebase database (Firestore). The list is searchable and
live-shared: everyone who is logged in immediately sees what the other adds.
Works as a PWA on the phone and is usable offline (additions are sent as soon
as the connection is back).

Styling and setup like [learn_words](../learn_words); hosting on GitHub Pages
like [julius-km-registratie](https://github.com/lucasdevries/kilometerregistratie).

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
   and click **Publish**. (Only signed-in users can then read/write.)
5. **Build → Authentication → Get started** → **Email/Password** → enable only
   "Email/Password" → Save.
6. **Users → Add user** tab: create one shared account (email + made-up
   password). Share it with whoever should be able to add words — everyone
   logs in as the same user.
7. **Settings** tab:
   - **User actions**: untick **"Enable create (sign-up)"**, so strangers cannot
     create their own account.
   - **Authorized domains**: add `lucasdevries.github.io` (localhost is already there).
8. Go to **Project Overview → ⚙ Project settings → Your apps → `</>` (web)**,
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

After filling in `firebase-config.js`: `git add -A && git commit -m "firebase config" && git push`.

### 3. On the phone

1. Open the URL in Safari (iPhone) or Chrome (Android).
2. **Share → Add to Home Screen** — the app then works as a standalone app.
3. Log in once with the shared account; it is remembered.

## How it works

- **Storage**: every word pair is a document in the Firestore collection
  `words` (`nl`, `fr`, `createdAt`). The free Spark plan handles tens of
  thousands of words and daily use with ease.
- **Live list**: the list listens in realtime (`onSnapshot`) — when someone
  else adds a word, you see it appear immediately.
- **CSV export**: the ⬇ CSV button downloads the list as `words.csv`
  (header `nl,fr`, oldest first) — ready to drop into `learn_words/lists/`.
- **Offline**: Firestore caches the list locally; words added offline are sent
  automatically once the connection is back.
- **Deleting**: the ✕ behind a word (with confirmation), for typos.
- **Security**: reading/writing requires being logged in; sign-up of new
  accounts is disabled. The Firebase config in the repo is deliberately
  public — that is standard for Firebase web apps.
