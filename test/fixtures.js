'use strict';

// Ekte topaz-bøtter, hentet fra en kjørende Homey 15. august 2026. Beholdt
// ordrett slik Nest leverte dem, inkludert felt vi ikke bruker: da fanger
// testene opp hvis en fremtidig endring plutselig begynner å lese noe som
// ikke er der på alle modeller.
//
// De tre er valgt fordi de dekker forskjellene: en nettdrevet Topaz-2.7 med
// bevegelse, en batteridrevet Topaz-2.33 uten, og den med lavest spenning.

// Nettdrevet. Merk auto_away: true, altså ingen til stede.
const WIRED_HALLWAY = {
  object_key: 'topaz.18B4300000000001',
  object_revision: 644,
  object_timestamp: 1786829886456,
  value: {
    auto_away: true,
    auto_away_decision_time_secs: 600,
    battery_health_state: 0,
    battery_level: 5257,
    capability_level: 2,
    co_status: 0,
    component_als_test_passed: true,
    component_buzzer_test_passed: true,
    component_co_test_passed: true,
    component_heat_test_passed: false,
    component_hum_test_passed: true,
    component_led_test_passed: true,
    component_pir_test_passed: true,
    component_smoke_test_passed: true,
    component_speaker_test_passed: true,
    component_temp_test_passed: true,
    component_us_test_passed: false,
    component_wifi_test_passed: true,
    description: 'Utenfor Soverom',
    device_locale: 'nb_NO',
    heat_status: 0,
    hushed_state: false,
    last_audio_self_test_end_utc_secs: 1785070104,
    latest_manual_test_cancelled: false,
    latest_manual_test_end_utc_secs: 1785605613,
    line_power_present: true,
    model: 'Topaz-2.7',
    removed_from_base: false,
    replace_by_date_utc_secs: 1815289200,
    serial_number: '06CA01AC00000001',
    smoke_status: 0,
    software_version: '5.0rc38',
    structure_id: '11111111-2222-3333-4444-555555555555',
    wifi_ip_address: '192.168.1.11',
    where_id: '00000000-0000-0000-0000-000100000002',
    wifi_mac_address: '18b430000001',
    wired_or_battery: 0,
  },
};

// Batteridrevet. line_power_present er false selv om enheten er frisk.
const BATTERY_KITCHEN = {
  object_key: 'topaz.18B4300000000002',
  object_revision: 24721,
  object_timestamp: 1786813131219,
  value: {
    auto_away: true,
    auto_away_decision_time_secs: 600,
    battery_health_state: 0,
    battery_level: 5187,
    capability_level: 2,
    co_status: 0,
    component_als_test_passed: true,
    component_buzzer_test_passed: true,
    component_co_test_passed: true,
    component_heat_test_passed: false,
    component_hum_test_passed: true,
    component_led_test_passed: true,
    component_pir_test_passed: true,
    component_smoke_test_passed: true,
    component_speaker_test_passed: true,
    component_temp_test_passed: true,
    component_us_test_passed: false,
    component_wifi_test_passed: true,
    description: 'Matbod',
    device_locale: 'nb_NO',
    heat_status: 0,
    hushed_state: false,
    last_audio_self_test_end_utc_secs: 1785070108,
    latest_manual_test_cancelled: false,
    latest_manual_test_end_utc_secs: 1785605621,
    line_power_present: false,
    model: 'Topaz-2.33',
    removed_from_base: false,
    replace_by_date_utc_secs: 1976857200,
    serial_number: '06AA01AC00000002',
    smoke_status: 0,
    software_version: '5.0rc38',
    structure_id: '11111111-2222-3333-4444-555555555555',
    wifi_ip_address: '192.168.1.12',
    where_id: '00000000-0000-0000-0000-00010000000a',
    wifi_mac_address: 'cca7c1000002',
    wired_or_battery: 1,
  },
};

// Lavest spenning av de sju, og uten `description`: Nest lar navnet stå tomt
// når rommet er valgt fra den innebygde lista i stedet for skrevet inn.
const BATTERY_OFFICE = {
  object_key: 'topaz.18B4300000000003',
  object_revision: -14474,
  object_timestamp: 1786714949207,
  value: {
    auto_away: true,
    battery_health_state: 0,
    battery_level: 5031,
    co_status: 0,
    component_co_test_passed: true,
    component_smoke_test_passed: true,
    component_wifi_test_passed: true,
    heat_status: 0,
    hushed_state: false,
    line_power_present: false,
    model: 'Topaz-2.33',
    removed_from_base: false,
    serial_number: '06AA01AC00000003',
    smoke_status: 0,
    software_version: '5.0rc38',
    where_id: 'aaaaaaaa-0001-0001-0001-000000000001',
    wifi_ip_address: '192.168.1.13',
    wired_or_battery: 1,
  },
};

// Romnavnene, hentet ordrett fra husstandens where-bøtte. Merk blandingen:
// rom Thomas har laget selv er norske, Nests innebygde er engelske. Structure-
// bøtta er bevisst ikke tatt med — den inneholder adresse og koordinater.
const WHERE_BUCKET = {
  object_key: 'where.11111111-2222-3333-4444-555555555555',
  object_revision: 12,
  object_timestamp: 1786829886456,
  value: {
    wheres: [
      { name: 'Inngangsdør', where_id: 'aaaaaaaa-0001-0001-0001-000000000004' },
      { name: 'Teknisk rom', where_id: 'aaaaaaaa-0001-0001-0001-000000000002' },
      { name: 'Matbod', where_id: 'aaaaaaaa-0001-0001-0001-000000000003' },
      { name: 'Kontor', where_id: 'aaaaaaaa-0001-0001-0001-000000000001' },
      { name: 'Stue & Kjøkken', where_id: 'aaaaaaaa-0001-0001-0001-000000000005' },
      { name: 'Garasje', where_id: 'aaaaaaaa-0001-0001-0001-000000000006' },
      { name: 'Soverom', where_id: 'aaaaaaaa-0001-0001-0001-000000000007' },
      { name: 'Entryway', where_id: '00000000-0000-0000-0000-000100000000' },
      { name: 'Basement', where_id: '00000000-0000-0000-0000-000100000001' },
      { name: 'Hallway', where_id: '00000000-0000-0000-0000-000100000002' },
      { name: 'Master Bedroom', where_id: '00000000-0000-0000-0000-000100000005' },
      { name: 'Kitchen', where_id: '00000000-0000-0000-0000-00010000000a' },
      { name: 'Guest Room', where_id: '00000000-0000-0000-0000-00010000001a' },
    ],
  },
};

// Ingen av de sju enhetene har noen gang stått i alarm mens vi har logget, så
// alarmtilstandene må konstrueres. Vi endrer bare statusfeltet og lar resten
// av bøtta stå: det er nøyaktig det Nest gjør når det brenner.
function withStatus(bucket, changes) {
  return {
    ...bucket,
    object_revision: (bucket.object_revision || 0) + 1,
    value: { ...bucket.value, ...changes },
  };
}

module.exports = {
  WIRED_HALLWAY,
  BATTERY_KITCHEN,
  BATTERY_OFFICE,
  WHERE_BUCKET,
  withStatus,
};
