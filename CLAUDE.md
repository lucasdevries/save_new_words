# Zwart boekje — NL ↔ FR woordenlijst

Statische PWA zonder build-stap: `index.html` + `app.js` + `style.css` staan
direct in de repo-root en worden door GitHub Pages geserveerd. Opslag in
Firebase Firestore (collectie `words`), login via Firebase Auth met één
gedeeld e-mail/wachtwoord-account. Zie README.md voor de eenmalige setup.

- Lokaal testen: `python3 -m http.server 8000` → http://localhost:8000
- Deployen: gewoon committen en pushen naar `main` (GitHub Pages).
- `firebase-config.js` bevat de (publieke) projectconfig; beveiliging zit in
  `firestore.rules` + uitgeschakelde sign-ups. Firebase-project hangt aan het
  **persoonlijke** Google-account van Lucas — nooit via een werkaccount.

## Versioning

Versie staat op twee plekken en loopt gelijk: `APP_VERSION` in `app.js`
(footer) en de `CACHE`-naam in `sw.js` (cache-invalidatie bij installed PWAs).
Bump bij features de minor (0.1.0 → 0.2.0), bij fixes de patch; commit en tag
`v<versie>`. Vormgeving is overgenomen van `../learn_words` — daar stijl-
wijzigingen ook doorvoeren als ze generiek zijn.
