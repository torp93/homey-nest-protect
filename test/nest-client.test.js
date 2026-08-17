'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { mergeBuckets, subscribeObjects } = require('../lib/nest-client');
const { parseTopaz, toCapabilities } = require('../lib/topaz');
const { WIRED_HALLWAY, BATTERY_KITCHEN } = require('./fixtures');

test('bøtter vi ikke fikk svar om blir stående', () => {
  // Nest svarer bare med det som er endret. Uten sammenslåing ville de andre
  // varslerne forsvunnet fra tilstanden ved hver eneste oppdatering.
  const merged = mergeBuckets([WIRED_HALLWAY, BATTERY_KITCHEN], [
    { ...WIRED_HALLWAY, object_revision: 999 },
  ]);

  assert.strictEqual(merged.length, 2);
  assert.ok(merged.some((b) => b.object_key === BATTERY_KITCHEN.object_key));
});

test('en delvis bøtte fjerner ikke felt vi allerede kjente', () => {
  // Dette er den farlige varianten: kommer det en oppdatering med bare
  // batterinivå, ville en ren erstatning etterlatt en bøtte uten smoke_status.
  // Den leses som ukjent, og en levende alarm ville forsvunnet fra Homey.
  const partial = {
    object_key: WIRED_HALLWAY.object_key,
    object_revision: 700,
    object_timestamp: 1786829999999,
    value: { battery_level: 5100 },
  };

  const [merged] = mergeBuckets([WIRED_HALLWAY], [partial]);
  const caps = toCapabilities(parseTopaz(merged));

  assert.strictEqual(merged.value.battery_level, 5100, 'ny verdi skal gjelde');
  assert.strictEqual(merged.value.smoke_status, 0, 'gammel verdi skal overleve');
  assert.strictEqual(merged.object_revision, 700, 'revisjonen skal oppdateres');
  assert.strictEqual(caps.alarm_smoke, false);
  assert.strictEqual(caps.measure_voltage, 5.1);
});

test('en delvis bøtte kan heve en alarm uten å røre resten', () => {
  const partial = {
    object_key: WIRED_HALLWAY.object_key,
    object_revision: 701,
    object_timestamp: 1786830000000,
    value: { smoke_status: 2 },
  };

  const [merged] = mergeBuckets([WIRED_HALLWAY], [partial]);
  const caps = toCapabilities(parseTopaz(merged));

  assert.strictEqual(caps.alarm_smoke, true);
  assert.strictEqual(caps.alarm_co, false, 'CO skal beholde kjent verdi');
  assert.strictEqual(merged.value.serial_number, WIRED_HALLWAY.value.serial_number);
});

test('en ukjent bøtte legges til', () => {
  const merged = mergeBuckets([WIRED_HALLWAY], [BATTERY_KITCHEN]);
  assert.strictEqual(merged.length, 2);
});

test('subscribe sender alle tre feltene Nest krever', () => {
  // Utelates timestamp, svarer Nest umiddelbart med alt, og løkka går varm.
  const [obj] = subscribeObjects([WIRED_HALLWAY]);

  assert.deepStrictEqual(Object.keys(obj).sort(), [
    'object_key', 'object_revision', 'object_timestamp',
  ]);
  assert.strictEqual(obj.object_revision, WIRED_HALLWAY.object_revision);
});
