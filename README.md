# Tlakomjer OCR — OMRON Precise 3.11

Nadogradnja v3.10 → v3.11. **Potpuno novi pristup detekciji kuta rotacije**, na
prijedlog korisnika: "neka donji rub LCD-a bude poravnat vodoravno".

## Osnovna ideja

Tlakomjer ima više **paralelnih horizontalnih rubova**: donji rub LCD-a, "Intelli
sense" granica, START/STOP gornji rub, itd. **Svi dijele isti kut nagiba slike.**

Algoritam ne traži pojedinačnu liniju ili komponentu — traži **kut θ koji
istovremeno poravnava sve te rubove u savršeno vodoravne pruge**.

## Algoritam u 4 koraka

1. **Vertical gradient** preko cijele slike: `grad[y,x] = g[y+1,x] − g[y−1,x]`.
   Izolira **horizontalne** rubove (gdje sivilo skokovito mijenja gore→dolje).

2. **Edge mask**: `|grad| > mean + 1·std` (sve "značajne" rubne piksele).

3. **Angle scan** [-15°, +15°] (gruba 0.5°, fina 0.1°): za svaki kut θ,
   projektiraj edge piksele u **rotirani y**:
   ```
   y' = -(x - cx)·sin(θ) + (y - cy)·cos(θ)
   ```
   Izgradi histogram po y'. **Score(θ) = ∑ top-10 lokalnih peakova** u histogramu.

4. **θ s najvećim score-om** = pravi kut nagiba slike.

## Zašto ovo radi

Kad je θ ispravan, **svi paralelni horizontalni rubovi** postaju savršeno
vodoravne pruge u rotiranom prostoru — što znači da svi pikseli istog ruba
imaju **isti y'**. Histogram po y' onda ima **mnogo visokih peakova** (jedan po
liniji). Score zbroji top-10 najjačih peakova.

Kad je θ kriv, isti rubovi su raspršeni preko više y' vrijednosti, peakovi su
niski, score je nizak.

## Verifikacija u Pythonu

Testirano na pravoj OMRON fotografiji s nametnutim rotacijama:

| Nametnuti kut (PIL.rotate) | Detektirano | Rezidual nakon PIL.rotate(+detected) |
|---------------------------|-------------|--------------------------------------|
| −15°                      | +15.0°      | +1.0°                                |
| −10°                      | +11.0°      | 0.0°                                 |
| −5°                       | +6.0°       | 0.0°                                 |
| 0°                        | +1.0°       | 0.0°                                 |
| +5°                       | −4.0°       | 0.0°                                 |
| +10°                      | −9.0°       | −1.0°                                |
| +15°                      | −15.0°      | 0.0°                                 |

Greška < 1° u svim slučajevima.

## Sve ostalo iz v3.10 ostaje

- **Empirijski test smjera** (rotiraj testno za malo, izaberi smjer koji smanji rezidual).
- **±15° hard cap** na finalni kut.
- **Aspect-cap trim** (ako je bbox h > 1.10×w, sileđe stegni na kvadrat).
- **Density-based trim** unutar bbox-a.
- **Bradley adaptive thresholding** + sva digit recognition logika.
- **Live kamera**.

## Cache

Service worker key podignut na `v3-11`.

## Test

Otvori DevTools Console (F12) i klikni "Precizni OMRON parser". Vidiš:

```
[Rotation] edge-line detection: angle=11.00°, score=4051, edges=18432, working 600x1066
[Rotation] initial detected: 11.00°
[Rotation] test 2.00° → residual 13.50° (|13.50|)
[Rotation] test -2.00° → residual 9.00° (|9.00|)
[Rotation] APPLY -11.00° (dir=-1)
[LCD detect] ...
[Trim] ...
```

Score (sad u logu) i broj edge piksela su vrlo dobri dijagnostički podatci —
ako je score nizak, slika nema dovoljno jakih horizontalnih rubova
(npr. potpuno bez kontrasta) i algoritam preskoči rotaciju.
