# Wordlist — NL ↔ FR word list

Static PWA without a build step: `index.html` + `app.js` + `style.css` live
directly in the repo root and are served by GitHub Pages. Storage in Firebase
Firestore (collection `words`), login via Firebase Auth with one shared
email/password account. See README.md for the one-time setup.

- Test locally: `python3 -m http.server 8000` → http://localhost:8000
- Deploy: simply commit and push to `main` (GitHub Pages).
- `firebase-config.js` contains the (public) project config; security lives in
  `firestore.rules` + disabled sign-ups. The Firebase project is tied to
  Lucas's **personal** Google account — never through a work account.

## Versioning

The version lives in two places that must stay in sync: `APP_VERSION` in
`app.js` (footer) and the `CACHE` name in `sw.js` (cache invalidation for
installed PWAs). Bump the minor for features (0.1.0 → 0.2.0), the patch for
fixes; commit and tag `v<version>`. Styling is adopted from `../learn_words` —
apply style changes there too when they are generic.
