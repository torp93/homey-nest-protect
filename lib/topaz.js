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
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function isEmergency(status) {
  return num(status) === STATUS_EMERGENCY;
}

// Varsel-flagget er sant også under full alarm. En flow som lytter på «varsel»
// vil vite at noe er galt, ikke bare at det er litt galt.
function isWarning(status) {
  const parsed = num(status);
  return parsed !== null && parsed >= STATUS_WARNING;
}

// Sekunder siden epoke til ISO-streng. Nest bruker sekunder her og
// millisekunder i `object_timestamp`, så de to må ikke blandes.
function secondsToIso(seconds) {
  const parsed = num(seconds);
  if (parsed === null || parsed <= 0) return null;
  return new Date(parsed * 1000).toISOString();
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
    occupancy: value.auto_away === false,
    occupancyReliable: wired,

    hushed: value.hushed_state === true,
    // Tatt av braketten.
    removedFromBase: value.removed_from_base === true,

    lastManualTest: secondsToIso(value.latest_manual_test_end_utc_secs),
    lastManualTestCancelled: value.latest_manual_test_cancelled === true,

    // Nest har ikke noe «tester nå»-flagg. Det utledes av at testen er startet
    // men ikke avsluttet: start > slutt. Når den er ferdig, flyttes slutt
    // forbi start igjen. En avbrutt test setter dem like.
    manualTestActive: num(value.latest_manual_test_start_utc_secs) !== null
      && num(value.latest_manual_test_end_utc_secs) !== null
      && num(value.latest_manual_test_start_utc_secs)
        > num(value.latest_manual_test_end_utc_secs),
    lastAudioSelfTest: secondsToIso(value.last_audio_self_test_end_utc_secs),
    replaceBy: secondsToIso(value.replace_by_date_utc_secs),

    wifiIp: value.wifi_ip_address || null,
    wifiMac: value.wifi_mac_address || null,
    structureId: value.structure_id || null,

    // De fem sjekkene Nest-appen selv viser, satt sammen av komponenttestene.
    // Nest grupperer dem slik i «Last checked», og de er langt lettere å tolke
    // gruppert enn som tolv enkeltflagg.
    checks: {
      sensors: [
        value.component_smoke_test_passed,
        value.component_co_test_passed,
        value.component_temp_test_passed,
        value.component_hum_test_passed,
        value.component_als_test_passed,
        value.component_pir_test_passed,
      ].every((passed) => passed !== false),
      alarm: value.component_buzzer_test_passed !== false,
      voice: value.component_speaker_test_passed !== false,
      battery: num(value.battery_health_state) === BATTERY_OK,
      wifi: value.component_wifi_test_passed !== false,
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
function toCapabilities(state) {
  const caps = {
    alarm_smoke: isEmergency(state.smoke),
    alarm_co: isEmergency(state.co),
    alarm_heat: isEmergency(state.heat),

    // Batterivarselet kommer fra Nests egen helsevurdering, ikke fra spenning.
    // Enheten vet mer om sine egne celler enn en terskel vi finner på.
    alarm_battery: state.batteryHealth !== null && state.batteryHealth !== BATTERY_OK,

    // Fjernet fra braketten er nærmeste sanne sabotasjesignal Protect gir.
    alarm_tamper: state.removedFromBase,

    // Trykk på knappen på selve varsleren. Det er den eneste måten å bevise
    // hele kjeden på uten å tenne på noe: alarmene slår bare ut på Nests
    // nivå 2, og en manuell test setter ikke smoke_status.
    alarm_manual_test: state.manualTestActive === true,
  };

  // Volt, ikke prosent. Nest oppgir millivolt uten å si hva tomt er, og en
  // oppdiktet prosentskala ville sett presis ut uten å være det. Spenningen
  // kan trendes i Insights, og alarm_battery sier når det haster.
  if (state.batteryMillivolt !== null) {
    caps.measure_voltage = Math.round(state.batteryMillivolt) / 1000;
  }

  // Bare nettdrevne enheter holder PIR-en våken. På batteridrevne ville
  // capabilityen stått evig false og sett ut som en sensor som ikke virker.
  if (state.occupancyReliable) {
    caps.alarm_motion = state.occupancy;
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
