# Tlakomjer OCR — OMRON Precise 3.12

Nadogradnja v3.11 → v3.12. Dvije ciljane popravke:

## 1. Detekcija kuta proširena na ±45°

V3.11 je tražila kut samo u rasponu [-15°, +15°]. Ako je tlakomjer snimljen
izrazito ukoso (npr. korisnik telefon drži pod kutom), korekcija nije
moguća jer pravi kut nije unutar pretrage.

Sad: **[-45°, +45°]** s 1° grubim korakom + 0.25° finim. Plus, `ANGLE_MAX` u
analizi (gornji safety cap) podignut s 20° na 45°.

## 2. NAKON ROTACIJE — LCD-square crop

Ovo je **najvažnija promjena**. Algoritam:

1. Rotacija ravna sliku (v3.11 + rotation pipeline iz v3.10).
2. **`findSquareLcdCrop`** nakon rotacije: traži povezanu komponentu koja je:
   - **Kvadratasta** (aspect 0.70–1.40)
   - Pokriva 4–65% slike
   - **Fill ratio 0.20–0.75** (LCD ima rupe od znamenki — to ga razlikuje od solidnih plastika)
   - **Gornja polovica slike** (y centra < 65% slike, jer LCD je iznad gumba)
3. Najbolji takav kandidat = LCD, **s padding-om 5%** oko bbox-a.
4. Sve dalje (autoScreenSearch, ROI-i SYS/DIA/PULSE, digit recognition) radi
   se **samo unutar tog kropa**.

Time se trajno rješavaju problemi gdje je screen-box "iscurio" prema dolje
preko "Intelli sense" labele i plastike kućišta.

## Verifikacija u Pythonu

Na uspravnoj OMRON slici (952×1693), LCD-square crop daje bbox
**(7, 259, 781×743)** s asp=1.05, fill=0.42 — točno LCD ploha bez plastike.

S padding-om 5%: **(0, 222, 859×817)** — i dalje ne uključuje "Intelli sense"
labelu (koja počinje na y≈1010).

## Sve ostalo iz v3.11 ostaje

- Edge-line based detekcija kuta (vertikalni gradient + projekcija edge piksela
  u rotirani y + scoring sum top-10 peakova).
- Empirijski test smjera rotacije.
- Bradley adaptive thresholding + template-matching scoring.
- Live kamera.

## Cache

Service worker key podignut na `v3-12`.

## Console.log u DevTools

Sad vidiš tijek:

```
[Rotation] edge-line detection: angle=11.00°, score=4051, edges=18432, working 600x1066
[Rotation] initial detected: 11.00°
[Rotation] test 3.00° → residual 8.00° (|8.00|)
[Rotation] test -3.00° → residual 13.00° (|13.00|)
[Rotation] APPLY 11.00° (dir=1)
[LCD-square] cropped to 0,222,859x817
[LCD detect] thr=131, 1 candidates: [...]
[Trim] ...
```

Ako "LCD-square" ne radi (`no LCD-square candidate`), algoritam i dalje koristi
sve postojeće mehanizme (autoScreenSearch + trim) na cijeloj slici.
