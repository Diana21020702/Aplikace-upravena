# Coffee tracker

Jednoduchá PWA aplikace pro evidenci vypitých nápojů.

## Co je nově doplněno

- **Offline režim přes `localStorage`**
- při nedostupném API nebo při ztrátě internetu se záznam uloží lokálně do fronty
- po obnovení připojení se uložené záznamy automaticky znovu odešlou na API
- rozpracovaný formulář i poslední vybraný uživatel se ukládají do `localStorage`
- bonus: **denní notifikace** se souhrnem toho, co bylo během dne zaznamenáno

## Proč je zvolený `localStorage`

Byl zvolen **`localStorage`**, protože data musí přežít i zavření karty nebo celého prohlížeče. To je pro offline frontu zásadní. `sessionStorage` by nestačil, protože se po zavření relace smaže a neodeslané záznamy by se ztratily.

## Jak funguje offline ukládání

1. uživatel vyplní formulář a klikne na odeslání
2. pokud je API dostupné, data se odešlou standardně
3. pokud API dostupné není nebo zařízení není online, payload se uloží do `localStorage`
4. při návratu připojení aplikace uloženou frontu automaticky odešle

## Denní notifikace

Aplikace si po povolení notifikací umí zobrazit denní souhrn zaznamenaných nápojů. Notifikace se zobrazí maximálně jednou za den.

## Spuštění

Stačí otevřít `index.html` nebo aplikaci nasadit na běžný statický hosting.
