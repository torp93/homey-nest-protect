'use strict';

const Homey = require('homey');

// Varslerne finnes allerede i appens tilstand når paringen åpnes, siden løkka
// startet ved oppstart. Paringen henter derfor ikke noe selv — den venter bare
// på at den første hentingen skal være ferdig.
const WAIT_TIMEOUT_MS = 30000;
const WAIT_POLL_MS = 500;

class ProtectDriver extends Homey.Driver {
  async onInit() {
    this.log('Nest Protect-driver startet');
  }

  async onPairListDevices() {
    const app = this.homey.app;
    const states = await this._waitForStates(app);

    if (states.size === 0) {
      // Uten dette får brukeren en tom liste uten forklaring, og den vanlige
      // årsaken er at innstillingene ikke er fylt ut ennå.
      const status = app.status();
      if (!status.configured) throw new Error(this.homey.__('error.notConfigured'));
      throw new Error(status.lastError || this.homey.__('error.noDevices'));
    }

    return [...states.values()].map(({ state, label }) => ({
      name: label,
      data: {
        // Serienummeret følger enheten gjennom bytte av navn, rom og nettverk.
        id: state.id,
      },
      // Bare nettdrevne varslere holder PIR-en våken. Legges capabilityen til
      // på de batteridrevne, står den evig false og ser ødelagt ut.
      capabilities: state.wired
        ? ['alarm_smoke', 'alarm_co', 'alarm_heat', 'alarm_battery', 'alarm_tamper', 'measure_voltage', 'alarm_motion']
        : ['alarm_smoke', 'alarm_co', 'alarm_heat', 'alarm_battery', 'alarm_tamper', 'measure_voltage'],
      settings: {
        serial: state.id,
        model: state.model || '—',
        power: state.wired ? 'wired' : 'battery',
      },
    }));
  }

  async _waitForStates(app) {
    const deadline = Date.now() + WAIT_TIMEOUT_MS;

    while (Date.now() < deadline) {
      const states = app.states();
      if (states.size > 0) return states;
      await new Promise((resolve) => this.homey.setTimeout(resolve, WAIT_POLL_MS));
    }

    return app.states();
  }
}

module.exports = ProtectDriver;
