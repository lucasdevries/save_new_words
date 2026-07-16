# Wordlist — NL ↔ FR word lists with flashcards

Static PWA without a build step: `index.html` + `app.js` + `style.css` live
directly in the repo root and are served by GitHub Pages. Firebase Auth
(email/password, open sign-up) and Firestore storage. The shared curriculum
is in `sharedLessons/{id}` (title) and `sharedWords/{id}` (nl, fr, lesson) —
read-only for users, writable only by the admin uid (Lucas, hardcoded in
`firestore.rules`; curriculum changes go via REST scripts, not the app).
Personal data sits under `users/{uid}/`: `words/{id}` is the notebook
(nl, fr, learned, wrong — progress on the doc) and `progress/{sharedWordId}`
is that user's progress over shared words. The flashcard engine is ported
from `../learn_words`; keep the behaviour aligned. See README.md for the
one-time setup.

- Test locally: `python3 -m http.server 8000` → http://localhost:8000
- Deploy: simply commit and push to `main` (GitHub Pages).
- `firebase-config.js` contains the (public) project config; security lives in
  `firestore.rules` (each uid only reaches its own subtree). The Firebase
  project is tied to Lucas's **personal** Google account — never through a
  work account. Rules changes must be pasted into the Firebase console by
  Lucas (Firestore → Rules) — there is no CLI deploy set up.

## Versioning

The version lives in two places that must stay in sync: `APP_VERSION` in
`app.js` (footer) and the `CACHE` name in `sw.js` (cache invalidation for
installed PWAs). Bump the minor for features (0.1.0 → 0.2.0), the patch for
fixes; commit and tag `v<version>`. Styling is adopted from `../learn_words` —
apply style changes there too when they are generic.
