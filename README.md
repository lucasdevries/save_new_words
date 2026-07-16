# Zwart boekje 📓

Een piepklein "zwart boekje" voor NL ↔ FR woorden: typ een woordcombinatie, tik
**Voeg toe**, en het staat opgeslagen in een gratis Firebase-database (Firestore).
De lijst is doorzoekbaar en live gedeeld: iedereen die is ingelogd ziet direct
wat de ander toevoegt. Werkt als PWA op de telefoon en is offline bruikbaar
(toevoegingen worden verstuurd zodra er weer verbinding is).

Vormgeving en opzet zoals [learn_words](../learn_words); hosting op GitHub Pages
zoals [julius-km-registratie](https://github.com/lucasdevries/kilometerregistratie).

## Eenmalige installatie

### 1. Firebase-project (de "backend") — ±5 minuten

> ⚠️ **Op een werklaptop:** doe dit in een **incognito/privé-venster** en log in
> met je **persoonlijke** Google-account, zodat het project nooit aan een
> werkaccount hangt.

1. Ga naar [console.firebase.google.com](https://console.firebase.google.com)
   en log in met je persoonlijke account.
2. **Add project** → naam bijv. `zwart-boekje` → Google Analytics **uit** → aanmaken.
3. **Build → Firestore Database → Create database** → locatie `eur3 (europe-west)`
   → **production mode**.
4. Tabblad **Rules**: vervang de inhoud door [`firestore.rules`](firestore.rules)
   en klik **Publish**. (Alleen ingelogde gebruikers kunnen dan lezen/schrijven.)
5. **Build → Authentication → Get started** → **Email/Password** → alleen
   "Email/Password" aanzetten → Save.
6. Tabblad **Users → Add user**: maak één gedeeld account aan (e-mail + zelfbedacht
   wachtwoord). Dit deel je met je vriendin — jullie loggen als dezelfde gebruiker in.
7. Tabblad **Settings**:
   - **User actions**: vink **"Enable create (sign-up)"** uit, zodat vreemden geen
     eigen account kunnen aanmaken.
   - **Authorized domains**: voeg `lucasdevries.github.io` toe (localhost staat er al).
8. Ga naar **Project Overview → ⚙ Project settings → Your apps → `</>` (web)**,
   registreer een app (naam maakt niet uit, hosting niet nodig) en kopieer het
   `firebaseConfig`-object naar [`firebase-config.js`](firebase-config.js) in deze
   repo. Deze waarden zijn niet geheim en mogen gewoon gecommit worden.

### 2. De app hosten

De app is een statische pagina; GitHub Pages is gratis en voldoende:

```sh
git init && git add -A && git commit -m "Zwart boekje"
gh repo create save_new_words --public --source=. --push
gh api repos/{owner}/save_new_words/pages -X POST \
  -f 'source[branch]=main' -f 'source[path]=/'
```

De app staat dan op `https://<gebruikersnaam>.github.io/save_new_words/`
(deze instantie: https://lucasdevries.github.io/save_new_words/).
Lokaal testen: `python3 -m http.server 8000` → http://localhost:8000.

Na het invullen van `firebase-config.js`: `git add -A && git commit -m "firebase config" && git push`.

### 3. Op de telefoon

1. Open de URL in Safari (iPhone) of Chrome (Android).
2. **Deel → Zet op beginscherm** — de app werkt daarna als losse app.
3. Log één keer in met het gedeelde account; dat wordt onthouden.

## Hoe het werkt

- **Opslag**: elke woordcombinatie is een document in de Firestore-collectie
  `words` (`nl`, `fr`, `createdAt`). Het gratis Spark-plan kan tienduizenden
  woorden en dagelijks gebruik moeiteloos aan.
- **Live lijst**: de lijst luistert realtime mee (`onSnapshot`) — voegt je
  vriendin iets toe, dan zie jij het meteen verschijnen.
- **Offline**: Firestore cachet de lijst lokaal; offline toegevoegde woorden
  worden automatisch verstuurd zodra er weer verbinding is.
- **Verwijderen**: het ✕-je achter een woord (met bevestiging), voor typfouten.
- **Beveiliging**: lezen/schrijven kan alleen ingelogd; aanmelden van nieuwe
  accounts staat uit. De Firebase-config in de repo is bewust publiek — dat is
  standaard bij Firebase-web-apps.
