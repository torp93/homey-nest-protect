'use strict';

const test = require('node:test');
const assert = require('node:assert');

const {
  parseTopaz, toCapabilities, warnings, STATUS_WARNING, STATUS_EMERGENCY,
} = require('../lib/topaz');
const {
  WIRED_HALLWAY, BATTERY_KITCHEN, BATTERY_OFFICE, withStatus,
} = require('./fixtures');

test('leser identitet og revisjon fra en ekte bøtte', () => {
  const state = parseTopaz(WIRED_HALLWAY);

  assert.strictEqual(state.id, '06CA01AC00000001');
  assert.strictEqual(state.objectKey, 'topaz.18B4300000000001');
  assert.strictEqual(state.revision, 644);
  assert.strictEqual(state.timestamp, 1786829886456);
  assert.strictEqual(state.name, 'Utenfor Soverom');
  assert.strictEqual(state.model, 'Topaz-2.7');
});

test('negativ revisjon er gyldig', () => {
  // Kontor sto med -14474. Revisjonen er en teller Nest ruller rundt, ikke et
  // antall, så en fortegnssjekk her ville stilnet enheten permanent.
  const state = parseTopaz(BATTERY_OFFICE);
  assert.strictEqual(state.revision, -14474);
});

test('manglende description gir null, ikke tom streng', () => {
  // Driveren faller tilbake til rommets navn når dette er null. En tom streng
  // ville blitt et enhetsnavn uten tegn.
  assert.strictEqual(parseTopaz(BATTERY_OFFICE).name, null);
});

test('skiller nettdrift fra batteridrift', () => {
  assert.strictEqual(parseTopaz(WIRED_HALLWAY).wired, true);
  assert.strictEqual(parseTopaz(BATTERY_KITCHEN).wired, false);
  assert.strictEqual(parseTopaz(BATTERY_OFFICE).wired, false);
});

test('alt i orden gir ingen alarmer', () => {
  const caps = toCapabilities(parseTopaz(WIRED_HALLWAY));

  assert.strictEqual(caps.alarm_smoke, false);
  assert.strictEqual(caps.alarm_co, false);
  assert.strictEqual(caps.alarm_heat, false);
  assert.strictEqual(caps.alarm_battery, false);
  assert.strictEqual(caps.alarm_tamper, false);
});

test('full alarm slår ut, varsel gjør det ikke', () => {
  const emergency = toCapabilities(parseTopaz(
    withStatus(BATTERY_KITCHEN, { smoke_status: STATUS_EMERGENCY }),
  ));
  assert.strictEqual(emergency.alarm_smoke, true);

  // Dette er hele grunnen til å skille nivåene: et «heads up» skal ikke låse
  // opp inngangsdøren.
  const warning = toCapabilities(parseTopaz(
    withStatus(BATTERY_KITCHEN, { smoke_status: STATUS_WARNING }),
  ));
  assert.strictEqual(warning.alarm_smoke, false);
});

test('varselflagget dekker både varsel og alarm', () => {
  const warned = warnings(parseTopaz(withStatus(BATTERY_KITCHEN, { co_status: STATUS_WARNING })));
  assert.strictEqual(warned.co, true);
  assert.strictEqual(warned.smoke, false);

  const alarmed = warnings(parseTopaz(withStatus(BATTERY_KITCHEN, { co_status: STATUS_EMERGENCY })));
  assert.strictEqual(alarmed.co, true);
});

test('CO og varme mappes hver for seg', () => {
  const caps = toCapabilities(parseTopaz(
    withStatus(BATTERY_KITCHEN, { co_status: STATUS_EMERGENCY, heat_status: STATUS_EMERGENCY }),
  ));

  assert.strictEqual(caps.alarm_co, true);
  assert.strictEqual(caps.alarm_heat, true);
  assert.strictEqual(caps.alarm_smoke, false);
});

test('batterivarsel følger Nests helsevurdering, ikke spenningen', () => {
  // Kontor har lavest spenning av alle sju, men Nest melder den frisk.
  const healthy = toCapabilities(parseTopaz(BATTERY_OFFICE));
  assert.strictEqual(healthy.alarm_battery, false);
  assert.strictEqual(healthy.measure_voltage, 5.031);

  const failing = toCapabilities(parseTopaz(
    withStatus(BATTERY_OFFICE, { battery_health_state: 1 }),
  ));
  assert.strictEqual(failing.alarm_battery, true);
});

test('spenning oppgis i volt', () => {
  assert.strictEqual(toCapabilities(parseTopaz(WIRED_HALLWAY)).measure_voltage, 5.257);
  assert.strictEqual(toCapabilities(parseTopaz(BATTERY_KITCHEN)).measure_voltage, 5.187);
});

test('bevegelse rapporteres kun for nettdrevne enheter', () => {
  // Batteridrevne lar PIR-en sove, så auto_away sier ingenting om rommet.
  // Capabilityen utelates helt i stedet for å stå evig false.
  assert.ok(!('alarm_motion' in toCapabilities(parseTopaz(BATTERY_KITCHEN))));

  const wired = toCapabilities(parseTopaz(WIRED_HALLWAY));
  assert.strictEqual(wired.alarm_motion, false);

  const occupied = toCapabilities(parseTopaz(withStatus(WIRED_HALLWAY, { auto_away: false })));
  assert.strictEqual(occupied.alarm_motion, true);
});

test('fjernet fra braketten gir sabotasjealarm', () => {
  const caps = toCapabilities(parseTopaz(
    withStatus(WIRED_HALLWAY, { removed_from_base: true }),
  ));
  assert.strictEqual(caps.alarm_tamper, true);
});

test('komponenthelse ignorerer sensorer modellen ikke har', () => {
  // component_heat_test_passed og component_us_test_passed står false på alle
  // sju enhetene. Tas de med, meldes hele huset defekt.
  assert.strictEqual(parseTopaz(WIRED_HALLWAY).componentsHealthy, true);

  const broken = parseTopaz(withStatus(WIRED_HALLWAY, { component_smoke_test_passed: false }));
  assert.strictEqual(broken.componentsHealthy, false);
});

test('datoer tolkes som sekunder, ikke millisekunder', () => {
  const state = parseTopaz(WIRED_HALLWAY);

  assert.strictEqual(state.replaceBy.slice(0, 4), '2027');
  assert.strictEqual(state.lastManualTest.slice(0, 7), '2026-08');
  assert.strictEqual(parseTopaz(BATTERY_KITCHEN).replaceBy.slice(0, 4), '2032');
});

test('felt som mangler gir null i stedet for å kaste', () => {
  const state = parseTopaz({});

  assert.strictEqual(state.id, null);
  assert.strictEqual(state.smoke, null);
  assert.strictEqual(state.replaceBy, null);
  assert.strictEqual(toCapabilities(state).alarm_smoke, false);
});

test('tom bøtte gir ingen spenning i stedet for null volt', () => {
  // measure_voltage 0 ville tegnet et fall til bunns i Insights.
  assert.ok(!('measure_voltage' in toCapabilities(parseTopaz({}))));
});
