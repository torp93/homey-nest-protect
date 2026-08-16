'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { buildWhereMap, deviceLabel, whereIdOf } = require('../lib/where');
const { parseTopaz } = require('../lib/topaz');
const { WIRED_HALLWAY, BATTERY_OFFICE, WHERE_BUCKET } = require('./fixtures');

test('bygger oppslag fra where-bøtta', () => {
  const map = buildWhereMap([WHERE_BUCKET]);

  assert.strictEqual(map.get('aaaaaaaa-0001-0001-0001-000000000001'), 'Kontor');
  assert.strictEqual(map.get('00000000-0000-0000-0000-000100000002'), 'Hallway');
  assert.strictEqual(map.get('aaaaaaaa-0001-0001-0001-000000000002'), 'Teknisk rom');
});

test('bøtter som ikke er where hoppes over', () => {
  assert.strictEqual(buildWhereMap([WIRED_HALLWAY]).size, 0);
  assert.strictEqual(buildWhereMap([]).size, 0);
});

test('rom og eget navn settes sammen', () => {
  // To varslere står begge i «Hallway». Uten det egne navnet ville de vært
  // umulige å skille i enhetslista.
  const state = parseTopaz(WIRED_HALLWAY);
  const map = buildWhereMap([WHERE_BUCKET]);

  assert.strictEqual(
    deviceLabel(state, map, whereIdOf(WIRED_HALLWAY)),
    'Hallway (Utenfor Soverom)',
  );
});

test('enhet uten eget navn får romnavnet', () => {
  // Dette er tilfellet for tre av de sju. Før dette oppslaget het de
  // serienummeret sitt.
  const state = parseTopaz(BATTERY_OFFICE);
  const map = buildWhereMap([WHERE_BUCKET]);

  assert.strictEqual(state.name, null);
  assert.strictEqual(deviceLabel(state, map, whereIdOf(BATTERY_OFFICE)), 'Kontor');
});

test('likt rom- og egennavn gjentas ikke', () => {
  const map = buildWhereMap([WHERE_BUCKET]);
  const state = { name: 'Kontor', id: 'X' };

  assert.strictEqual(
    deviceLabel(state, map, 'aaaaaaaa-0001-0001-0001-000000000001'),
    'Kontor',
  );
});

test('ukjent rom faller tilbake på eget navn, så serienummer', () => {
  const map = buildWhereMap([WHERE_BUCKET]);

  assert.strictEqual(deviceLabel({ name: 'Loft', id: 'X' }, map, 'finnes-ikke'), 'Loft');
  assert.strictEqual(deviceLabel({ name: null, id: 'X' }, map, 'finnes-ikke'), 'X');
  assert.strictEqual(deviceLabel({}, map, null), 'Nest Protect');
});
