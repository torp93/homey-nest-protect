Røyk-, CO- og varmealarmer fra Nest Protect, i det øyeblikket de skjer.

Googles offisielle API dekker ikke Nest Protect i det hele tatt — det når
termostater, kameraer og dørklokker, men aldri røykvarslere. Denne appen tar
samme vei inn som Nest-appen selv bruker, og gjør én ting med den.

Appen holder en åpen forbindelse mot Nest, så en alarm når Homey i samme sekund
den uler, ikke ved neste henting.

Hver varsler rapporterer røyk, karbonmonoksid og varme, batterivarsel og
spenning, om den er tatt av braketten, og en manuell test du kan bruke for å
bekrefte at hele kjeden virker uten en ekte brann. Nettdrevne enheter melder
også tilstedeværelse. Modell, serienummer, utskiftingsdato og de fem
selvtestene ligger i enhetsinnstillingene.

Flow-kortene dekker tidlige farevarsler, at forbindelsen til Nest ryker eller
kommer tilbake, og en betingelse for om Nest er tilgjengelig. Røykvarslere er
stille i månedsvis, så en brutt forbindelse ser nøyaktig ut som et rolig hus —
forbindelseskortet finnes for å skille de to.

OPPSETT

Google fjernet tilgang med API-nøkkel, så innlogging krever to verdier som
kopieres for hånd fra en innlogget nettleserøkt. Appinnstillingene forklarer
hvor du finner dem.

Den cookien er en øktnøkkel for hele Google-kontoen din, ikke et Nest-avgrenset
token. Hold den unna skjermbilder og feilrapporter.

FØR DU STOLER PÅ DEN

Nest Protect uler lokalt og seg imellom uansett hva denne appen gjør. Behandle
Homey som varsling og automasjon på toppen av det, aldri som en del av selve
sikkerhetskjeden.

Uoffisiell og udokumentert. Ikke tilknyttet Google eller Nest. Protokollarbeidet
bygger på ha-nest-protect og homebridge-nest.
