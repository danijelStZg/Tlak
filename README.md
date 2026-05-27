# Tlakomjer v4.0 — Mobile PWA

Mobile-first verzija aplikacije za praćenje krvnog tlaka. Sav OCR engine iz v3.12
ostaje netaknut, ali UI je potpuno prepisan za korištenje na mobitelu kao
**Progressive Web App** (offline-capable, instalabilna na home screen).

## Funkcionalnosti

### Glavni ekran
- **Lista mjerenja**, kronološki, grupiraj po danu ("Danas", "Jučer", datum)
- **Statistike** na vrhu: prosjek SYS/DIA, broj mjerenja, posljednje
- **Color-coded vrijednosti**: SYS crveno, DIA zeleno, PULS plavo
- **Veliki FAB gumb "📷 Snimi"** za automatsko očitanje kamerom
- **Mali FAB "✏️"** za ručni unos
- **Izvor mjerenja** (📷 ikona ako je iz kamere, prazno ako ručno)

### Snimanje kamerom
- Live preview u fullscreen-u s **vodilicom za frejmanje** LCD-a
- Tap "snap" gumb → analiza (1-2s) → **rezultat overlay** s SYS/DIA/PULS
- **Pouzdanost** prikazana kao postotak (zelena badge ≥70%, crvena <70%)
- Korisnik može **urediti** brojeve prije spremanja (ako algoritam pogriješi)
- "Ponovo" za retry, "Spremi" za pohranu
- "🔄" gumb za flip između front/back kamere
- **Slika se nigdje ne sprema** — direktno iz video frame-a u canvas u analizu

### Ručni unos
- SYS / DIA / PULS / datum-vrijeme / napomena
- Edit gumb na svakom postojećem mjerenju u listi
- Validacija (sva tri broja obavezna)

### Izbornik (⋮)
- 📤 **Izvoz u CSV** (svi povijesni podaci)
- 🗑 **Obriši sve** (s potvrdom)
- 🔧 **Dijagnostika** (zadnja analiza — original, procesirano, JSON)

## PWA značajke

- **Offline** — service worker cache-ira sve fajlove (app.js, style.css, ikone)
- **Instalabilna** — "Add to Home Screen" u browseru daje icon na home screen
- **Standalone display mode** — bez browser UI-ja, izgleda kao native app
- **Portrait orientation lock**
- **Theme color** se prilagođava status bar-u (#0f172a)
- **Safe area insets** — radi na iPhone-ima s notch-em
- **Pravo touch-friendly** — gumbi 44+ px, no-zoom inputs (font-size 16px)

## Tehnički detalji

- LocalStorage za perzistenciju (`tlakomjer-history-v4-0` key)
- Service Worker v4-0 — network-first za HTML, cache-first za assets
- Manifest za installability
- Tesseract.js učitava se s CDN-a (lazy — koristi se samo kao fallback)
- Sva OCR logika offline jer je u app.js (Bradley adaptive + template matching)

## Storage format

```js
{
  id: "uuid",
  sys: 113, dia: 82, pulse: 54,
  timestamp: "2025-05-27T07:55:00.000Z",
  createdAt: "2025-05-27T07:56:23.123Z",
  source: "omron-precise-4.0",  // ili "manual" / "edited"
  confidence: 0.94,
  note: "opcionalna napomena"
}
```

## Deploy

PWA traži HTTPS (osim za localhost). Opcije:
- **GitHub Pages** — push u repo, omogući Pages, automatski HTTPS
- **Netlify / Vercel** — drag-drop folder, dobiješ HTTPS URL
- **Cloudflare Pages** — slično

## Test lokalno

```bash
cd tlakomjer_app_v4_0_mobile
python3 -m http.server 8000
# Otvori http://localhost:8000 u Chrome/Safari na mobitelu
# (mora biti localhost; getUserMedia neće raditi preko file://)
```

Za testing s mobitelom u istoj WiFi mreži:
```bash
# Generiraj self-signed cert
openssl req -x509 -newkey rsa:4096 -nodes -keyout key.pem -out cert.pem -days 365 -subj "/CN=localhost"
# Pokreni HTTPS server
python3 -c "import http.server, ssl; s=http.server.HTTPServer(('0.0.0.0',8443),http.server.SimpleHTTPRequestHandler); ctx=ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER); ctx.load_cert_chain('cert.pem','key.pem'); s.socket=ctx.wrap_socket(s.socket,server_side=True); s.serve_forever()"
# Otvori https://<IP-tvog-laptopa>:8443
# (prihvati certifikat upozorenje)
```

## Sve od OCR pipelinea (v3.12)

- Edge-line based detekcija kuta rotacije (±45°)
- Empirijski test smjera rotacije
- LCD-square crop nakon rotacije (uklanja "Intelli sense" labelu)
- Bradley adaptive thresholding
- Morfološki close + ensemble glasovanje preko 5 varijanti
- Template-matching scoring za sedmosegmentno prepoznavanje
- Detekcija znamenke "1" kao posebnog slučaja
- Console.log dijagnostika u DevTools
