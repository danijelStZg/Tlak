# Tlakomjer OCR — OMRON Precise 3.7

Nadogradnja v3.6 → v3.7. Točkasti fix: na fotografiji gdje je tlakomjer manji u
kadru i odijelu/pozadini je vidljiv, v3.6 je:

1. **Detektirao predugačku komponentu** kao "LCD" jer je uz pravi LCD priložio i
   plastiku ispod (do "Intelli sense" labele). To je razbacalo ROI-e: PULSE redak
   pao je u plastiku umjesto u "54".
2. **Nije izvršio rotaciju** za blagi nagib (~5°), jer je 1.5° prag bio previsok
   i jer je LCD bbox koji je našao bio "nakošen" prema kućištu, ne prema LCD-u.

## Konkretni popravci

### Strožiji fill-aware filtar LCD-a

Pravi OMRON LCD ima **fill ratio ~ 0.40–0.50** (puno rupa od znamenki i blank
pozadine). Plastika kućišta, gumbi, tijelo telefona imaju fill > 0.75. v3.7
sad:
- Odbacuje sve komponente s fill > 0.75 (prije 0.92).
- Daje **bonus +0.8 score-a** komponentama s fill između 0.30–0.65 (LCD karakteristično).
- Manji bonus +0.3 za fill < 0.30 (vrlo prazne komponente, npr. dijelovi LCD-a).

Time pravi LCD pobjeđuje čak i ako ima manji bbox od neke druge tamne komponente.

### Šire područje veličine

- `minArea` LCD-a: 0.5% slike umjesto 1% — radi za tlakomjere koji su daleko u kadru.
- Bbox raspon: 4%–85% (prije 6%–80%).
- Aspect: 0.5–2.2 (prije 0.6–2.0) — toleriraju se i blago "izduženi" LCD-ovi.

### Niži prag rotacije (1.5° → 0.8°)

Sad se rotacija izvršava i za blage nagibe ~1°. Praktično: 5° nagiba uvijek
ide u korekciju.

### Console.log dijagnostika

LCD detekcija i rotacijska detekcija sad ispisuju što su pronašle na konzoli:

```
[Rotation] detected angle=-5.25°, LCD bbox=120,340,400x420, fill=0.443
[LCD detect] thr=132, 2 candidates: [{bbox: "118,338,402x422", fill: "0.443", aspect: "0.95", score: "2.043"}, ...]
```

Otvori DevTools konzolu u browseru i odmah vidiš što ide krivo ako se dogodi.

## Sve ostalo iz v3.6 ostaje

- Auto-rotacija (min-area rotated rectangle).
- Live kamera (getUserMedia, bez file sustava).
- Bradley adaptive thresholding + separabilan morfološki close.
- Template-matching scoring (LSQ).
- LCD detekcija kao najveća tamna komponenta.

## Cache

Service worker key podignut na `v3-7`. Mobilni će automatski povući novu verziju.

## Test

1. Otvori `index.html` preko HTTPS-a ili lokalnog dev-servera.
2. Učitaj fotografiju ili snimi kamerom.
3. Klikni „Precizni OMRON parser".
4. Otvori DevTools (F12 → Console) — vidiš detekcijske logove uživo.
5. U „Dijagnostika" panelu pogledaj `rotation.angle` i `rotation.applied`.

Ako rotacija i dalje ne radi za neku sliku, console log će reći ZAŠTO:
"no LCD candidate" znači da niti jedna komponenta ne prolazi kriterije — onda
treba dodatno popustiti prag (npr. fill > 0.80) ili dodati pretragu po
horizontalno-vertikalnim gradijentima.
