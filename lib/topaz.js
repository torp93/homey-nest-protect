'use strict';

// Et `topaz`-objekt er Nests interne representasjon av en Protect. Feltene her
// er de vi faktisk bruker; bøtta inneholder rundt seksti til, og de fleste er
// fabrikktesting og radiodetaljer som ikke sier brukeren noe.

// Statusfeltene er tredelte: 0 i orden, 1 varsel («heads up»), 2 full alarm.
// Nest skiller dem fordi et varsel gir en rolig stemmebeskjed mens en alarm
// uler — og en flow som låser opp inngangsdøren skal bare fyre på det siste.
const STATUS_OK = 0;
const STATUS_WARNING = 1;
const STATUS_EMERGENCY = 2;

// battery_health_state: 0 er i orden, alt annet betyr bytt batteri.
const BATTERY_OK = 0;

// wired_or_battery: 0 = nettdrevet, 1 = batteridrevet. `line_power_present`
// sier omtrent det samme, men står false på batterienheter uansett tilstand,
// så vi leser begge og lar dem bekrefte hverandre.
const WIRED = 0;

function num(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

// Tre utfall, ikke to: sant, usant, og «Nest sa ingenting». Det siste må ikke
// kollapse til usant — for en røykvarsler er forskjellen på «ingen røyk» og
// «vi vet ikke» hele poenget.
function bool(value) {
  if (value === true) return true;
  if (value === false) return false;
  return null;
}

// Slår sammen flere komponentflagg til én vurdering. Flagg Nest ikke sendte
// teller ikke med, og sendte den ingen av dem, er svaret ukjent — ikke bestått.
function check(...flags) {
  const known = flags.filter((flag) => flag === true || flag === false);
  if (known.length === 0) return null;
  return known.every((flag) => flag === true);
}

// null inn gir null ut. Den som kaller skal da la capabilityen stå urørt, ikke
// skrive «ingen alarm».
function isEmergency(status) {
  const parsed = num(status);
  // Større eller lik, ikke lik. Skulle Nest en dag innføre et nivå over 2,
  // ville likhetstesten degradert det fra full alarm til varsel — feil vei å
  // ta feil på.
  return parsed === null ? null : parsed >= STATUS_EMERGENCY;
}

// Varsel-flagget er sant også under full alarm. En flow som lytter på «varsel»
// vil vite at noe er galt, ikke bare at det er litt galt.
function isWarning(status) {
  const parsed = num(status);
  return parsed === null ? null : parsed >= STATUS_WARNING;
}

// Sekunder siden epoke til ISO-streng. Nest bruker sekunder her og
// millisekunder i `object_timestamp`, så de to må ikke blandes.
function secondsToIso(seconds) {
  const parsed = num(seconds);
  if (parsed === null || parsed <= 0) return null;
  return new Date(parsed * 1000).toISOString();
}

function msToIso(ms) {
  const parsed = num(ms);
  if (parsed === null || parsed <= 0) return null;
  return new Date(parsed).toISOString();
}

// Normaliserer en topaz-bøtte til det appen bryr seg om. Rene funksjoner hele
// veien: hele mappingen kan testes mot ekte bøtter uten å røre nettverket.
function parseTopaz(bucket) {
  const value = (bucket && bucket.value) || {};
  const objectKey = (bucket && bucket.object_key) || null;

  const wiredOrBattery = num(value.wired_or_battery);
  const linePower = value.line_power_present === true;
  const wired = wiredOrBattery === WIRED || linePower;

  return {
    // Serienummeret er det eneste feltet som følger enheten gjennom bytte av
    // wifi, navn og rom. Det er derfor enhetens id i Homey.
    id: value.serial_number || null,
    objectKey,
    revision: num(bucket && bucket.object_revision),
    timestamp: num(bucket && bucket.object_timestamp),

    // Når Nest sist skrev en endring om denne enheten. Ikke det samme som
    // Nest-appens «last checked» per sensor — de tidspunktene finnes ikke i
    // bøtta i det hele tatt. Timesjekken varsleren gjør setter ikke noe nytt
    // tidsstempel med mindre en verdi faktisk ble annerledes, så feltet sier
    // hvor gamle avlesningene høyst er, ikke at de er vurdert på nytt.
    reportedAt: msToIso(bucket && bucket.object_timestamp),

    name: value.description || null,
    model: value.model || null,
    softwareVersion: value.software_version || null,

    smoke: num(value.smoke_status),
    co: num(value.co_status),
    heat: num(value.heat_status),

    batteryHealth: num(value.battery_health_state),
    // Millivolt. Ingen prosentregning her, se toCapabilities().
    batteryMillivolt: num(value.battery_level),

    wired,
    linePowerPresent: linePower,

    // Nest kaller det auto_away: sant betyr at ingen har vært der på en stund.
    // Vi snur det til tilstedeværelse, som er slik folk tenker. Bare
    // nettdrevne enheter holder PIR-en våken; batteridrevne lar den sove, og
    // da er feltet meningsløst.
    occupancy: bool(value.auto_away) === null ? null : bool(value.auto_away) === false,
    occupancyReliable: wired,

    hushed: bool(value.hushed_state),
    // Tatt av braketten.
    removedFromBase: bool(value.removed_from_base),

    lastManualTest: secondsToIso(value.latest_manual_test_end_utc_secs),
    lastManualTestCancelled: value.latest_manual_test_cancelled === true,

    // Nest har ikke noe «tester nå»-flagg. Det utledes av at testen er startet
    // men ikke avsluttet: start > slutt. Når den er ferdig, flyttes slutt
    // forbi start igjen. En avbrutt test setter dem like. Mangler feltene, vet
    // vi ikke — og da sier vi ikke noe.
    manualTestActive: (num(value.latest_manual_test_start_utc_secs) === null
      || num(value.latest_manual_test_end_utc_secs) === null)
      ? null
      : num(value.latest_manual_test_start_utc_secs)
        > num(value.latest_manual_test_end_utc_secs),
    lastAudioSelfTest: secondsToIso(value.last_audio_self_test_end_utc_secs),
    replaceBy: secondsToIso(value.replace_by_date_utc_secs),

    wifiIp: value.wifi_ip_address || null,
    wifiMac: value.wifi_mac_address || null,
    structureId: value.structure_id || null,

    // De fem sjekkene Nest-appen selv viser, satt sammen av komponenttestene.
    // Nest grupperer dem slik i «Last checked», og de er langt lettere å tolke
    // gruppert enn som tolv enkeltflagg.
    //
    // Sier Nest ingenting om en gruppe, blir den null. Uten det ville en tom
    // eller ufullstendig payload meldt «alt i orden» på alle fem, fordi
    // `undefined !== false` er sant — altså en trygghetsmelding oppdiktet fra
    // fravær av data.
    checks: {
      sensors: check(
        value.component_smoke_test_passed,
        value.component_co_test_passed,
        value.component_temp_test_passed,
        value.component_hum_test_passed,
        value.component_als_test_passed,
        value.component_pir_test_passed,
      ),
      alarm: check(value.component_buzzer_test_passed),
      voice: check(value.component_speaker_test_passed),
      battery: num(value.battery_health_state) === null
        ? null
        : num(value.battery_health_state) === BATTERY_OK,
      wifi: check(value.component_wifi_test_passed),
    },

    // Fabrikktestene rapporteres per komponent. `heat` og `us` står false på
    // alle Topaz-modeller vi har sett, de mangler simpelthen de sensorene, så
    // de holdes utenfor helsevurderingen for ikke å gi falsk alarm.
    componentsHealthy: [
      value.component_smoke_test_passed,
      value.component_co_test_passed,
      value.component_wifi_test_passed,
      value.component_buzzer_test_passed,
      value.component_speaker_test_passed,
      value.component_pir_test_passed,
      value.component_temp_test_passed,
      value.component_hum_test_passed,
      value.component_als_test_passed,
      value.component_led_test_passed,
    ].every((passed) => passed !== false),
  };
}

// Fra normalisert tilstand til Homey-capabilities. Skilt fra parseTopaz slik at
// endringer i hvilke capabilities driveren tilbyr ikke rører tolkningen av
// protokollen.
// Bare kjente verdier havner i resultatet. En capability som mangler her skal
// den som kaller la stå urørt, slik at forrige kjente verdi blir stående i
// stedet for å bli overskrevet med en beroligende usannhet.
function toCapabilities(state) {
  const caps = {};
  const set = (name, value) => {
    if (value !== null && value !== undefined) caps[name] = value;
  };

  set('alarm_smoke', isEmergency(state.smoke));
  set('alarm_co', isEmergency(state.co));
  set('alarm_heat', isEmergency(state.heat));

  // Batterivarselet kommer fra Nests egen helsevurdering, ikke fra spenning.
  // Enheten vet mer om sine egne celler enn en terskel vi finner på.
  set('alarm_battery', state.batteryHealth === null ? null : state.batteryHealth !== BATTERY_OK);

  // Fjernet fra braketten er nærmeste sanne sabotasjesignal Protect gir.
  set('alarm_tamper', state.removedFromBase);

  // Trykk på knappen på selve varsleren. Det er den eneste måten å bevise hele
  // kjeden på uten å tenne på noe: alarmene slår bare ut på Nests nivå 2, og
  // en manuell test setter ikke smoke_status.
  set('alarm_manual_test', state.manualTestActive);

  // Volt, ikke prosent. Nest oppgir millivolt uten å si hva tomt er, og en
  // oppdiktet prosentskala ville sett presis ut uten å være det. Spenningen
  // kan trendes i Insights, og alarm_battery sier når det haster.
  // Større enn null, ikke bare «finnes». En rapportert 0 mV er ikke et
  // batterinivå, det er et hull i dataene — og ført inn i Insights tegner det
  // et fall til bunns som aldri skjedde.
  if (state.batteryMillivolt > 0) {
    caps.measure_voltage = Math.round(state.batteryMillivolt) / 1000;
  }

  // Bare nettdrevne enheter holder PIR-en våken. På batteridrevne ville
  // capabilityen stått evig false og sett ut som en sensor som ikke virker.
  if (state.occupancyReliable) {
    set('alarm_motion', state.occupancy);
  }

  return caps;
}

// Varselnivåene ligger utenfor capabilities fordi Homey ikke har en egen
// «nesten-alarm». De eksponeres som flow-triggere i stedet.
function warnings(state) {
  return {
    smoke: isWarning(state.smoke),
    co: isWarning(state.co),
    heat: isWarning(state.heat),
  };
}

module.exports = {
  STATUS_OK,
  STATUS_WARNING,
  STATUS_EMERGENCY,
  parseTopaz,
  toCapabilities,
  warnings,
  isEmergency,
  isWarning,
};
