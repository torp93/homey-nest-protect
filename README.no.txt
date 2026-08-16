Røyk-, CO- og varmealarmer fra Nest Protect, i det øyeblikket de skjer.

Googles offisielle Smart Device Management-API dekker ikke Nest Protect i det
hele tatt — det når termostater, kameraer, dørklokker og skjermer, men
røykvarslere har aldri vært med. Denne appen tar samme vei inn som Nest-appen
selv bruker, og gjør én ting med den: Nest Protect, ordentlig.

Alarmer kommer i sanntid. Appen holder en åpen forbindelse mot Nest og får
beskjed i samme sekund noe endrer seg, i stedet for å spørre med jevne
mellomrom og få vite det for sent.

HVA DU FÅR

Per varsler:
- Røyk-, karbonmonoksid- og varmealarm
- Manuell test, så du kan bekrefte at hele kjeden virker uten en ekte brann
- Tatt av braketten
- Batterivarsel, basert på Nests egen vurdering
- Batterispenning, som kan følges over tid i Insights
- Tilstedeværelse, kun på nettdrevne enheter
- Modell, serienummer, programvare, utskiftingsdato og siste manuelle test
- De fem selvtestene Nest-appen viser: sensorer, alarm, stemme, batteri og
  Wi-Fi

Flow-kort:
- Et farevarsel startet — Nest melder et stigende nivå før den uler for fullt,
  og kortet fyrer på det forvarselet, ikke på selve alarmen
- Forbindelsen til Nest endret seg — røykvarslere er stille i månedsvis, så en
  brutt forbindelse ser nøyaktig ut som et rolig hus
- Hent alt fra Nest nå
- Nest er tilkoblet — som betingelse

Bare full alarm hever røyk-, CO- og varmealarmen. Nest melder tre nivåer, og en
flow som låser opp en dør når huset brenner skal ikke fyre på damp fra dusjen.

Batteri oppgis som spenning, ikke prosent. Nest gir millivolt uten å si hva tomt
er, og en oppdiktet prosentskala ville sett mer presis ut enn den er.

OPPSETT

Google fjernet tilgang med API-nøkkel, så innlogging krever to verdier som
kopieres for hånd fra en innlogget nettleserøkt: en issue token-URL og en
cookie. Appinnstillingene forklarer steg for steg hvor du finner dem.

Vær klar over hva den cookien er. Den er en øktnøkkel for hele Google-kontoen
din, ikke et Nest-avgrenset token. Hold den unna skjermbilder og feilrapporter.
Den slutter å virke hvis du logger ut av nettleserøkten eller bytter passord, og
da må verdiene hentes på nytt.

FØR DU STOLER PÅ DEN

Nest Protect uler lokalt og seg imellom uansett hva denne appen måtte gjøre.
Behandle Homey som varsling og automasjon på toppen av det, aldri som en del av
selve sikkerhetskjeden.

Appen bruker et udokumentert grensesnitt som Google kan endre eller stenge uten
varsel. Den er ikke tilknyttet Google eller Nest.

Protokollarbeidet bygger på de åpne prosjektene ha-nest-protect og
homebridge-nest. Dette er en selvstendig implementasjon for Homey.
