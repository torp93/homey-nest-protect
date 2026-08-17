'use strict';

const Homey = require('homey');
const { capabilitiesFor } = require('../../lib/protect-config');

// Varslerne finnes allerede i appens tilstand når paringen åpnes, siden løkka
// startet ved oppstart. Paringen henter derfor ikke noe selv — den venter bare
// på at den første hentingen skal være ferdig.
const WAIT_TIMEOUT_MS = 30000;

class ProtectDriver extends Homey.Driver {
  async onInit() {
    this.log('Nest Protect-driver startet');
  }

  async onPairListDevices() {
    const app = this.homey.app;
    const states = await this._waitForStates(app);

    if (states.size === 0) throw new Error(this._explainEmpty(app));

    this.log(`Paring fant ${states.size} varsler(e)`);

    return [...states.values()].map(({ state, label }) => ({
      name: label,
      data: {
        // Serienummeret følger enheten gjennom bytte av navn, rom og nettverk,
        // så Homey kjenner den igjen som samme fysiske enhet.
        id: state.id,
      },
      capabilities: capabilitiesFor(state),
      settings: {
        serial: state.id,
        model: state.model || '—',
        power: this.homey.__(state.wired ? 'settings.wired' : 'settings.battery'),
      },
    }));
  }

  // Hvorfor lista er tom, formulert slik at brukeren vet hva han skal gjøre.
  // Den tekniske årsaken hører hjemme i loggen, ikke i en dialog midt i paring.
  _explainEmpty(app) {
    const status = app.status();

    if (!status.configured) return this.homey.__('error.notConfigured');

    if (!status.connected) {
      if (status.lastError) this.error(`Paring uten forbindelse: ${status.lastError}`);
      return this.homey.__('error.pairNoConnection');
    }

    return this.homey.__('error.noDevices');
  }

  // Venter på at appen publiserer, i stedet for å polle. Har den allerede
  // publisert, vet vi svaret med en gang og trenger ikke vente i det hele tatt.
  _waitForStates(app) {
    const known = app.states();
    if (known.size > 0) return Promise.resolve(known);
    if (app.status().lastUpdate) return Promise.resolve(known);

    return new Promise((resolve) => {
      let settled = false;

      const finish = (states) => {
        if (settled) return;
        settled = true;
        app.protect.off('states', onStates);
        this.homey.clearTimeout(timer);
        resolve(states);
      };

      const onStates = (states) => finish(states);
      // Uten opprydding her ville hver avbrutte paring etterlatt en lytter.
      const timer = this.homey.setTimeout(() => finish(app.states()), WAIT_TIMEOUT_MS);

      app.protect.on('states', onStates);
    });
  }
}

module.exports = ProtectDriver;
