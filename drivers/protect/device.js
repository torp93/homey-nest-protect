'use strict';

const Homey = require('homey');
const { toCapabilities, warnings } = require('../../lib/topaz');

class ProtectDevice extends Homey.Device {
  async onInit() {
    this._id = String(this.getData().id);
    this._warnings = { smoke: false, co: false, heat: false };

    // Appen holder én forbindelse for alle enhetene. Vi lytter i stedet for å
    // hente selv.
    this._onStates = (states) => this._apply(states).catch(
      (error) => this.error('Kunne ikke oppdatere', error),
    );
    this._onConnection = (connected) => {
      if (connected) this.setAvailable().catch(() => {});
      else this.setUnavailable(this.homey.__('error.disconnected')).catch(() => {});
    };

    this.homey.app.protect.on('states', this._onStates);
    this.homey.app.protect.on('connection', this._onConnection);

    // Appen kan ha hentet data før enheten rakk å starte.
    const known = this.homey.app.states();
    if (known.size > 0) this._onStates(known);

    this.log(`${this.getName()} klar`);
  }

  async onUninit() {
    this.homey.app.protect.off('states', this._onStates);
    this.homey.app.protect.off('connection', this._onConnection);
  }

  async _apply(states) {
    const entry = states.get(this._id);

    if (!entry) {
      // Varsleren er borte fra kontoen. Enheten gjøres utilgjengelig, ikke
      // slettet: å fjerne den ville tatt med seg flowene den er brukt i.
      await this.setUnavailable(this.homey.__('error.deviceGone'));
      return;
    }

    await this.setAvailable();

    const { state } = entry;
    const caps = toCapabilities(state);

    for (const [capability, value] of Object.entries(caps)) {
      if (!this.hasCapability(capability)) continue;
      // Homey stempler bare når verdien faktisk endrer seg, så det koster
      // ingenting å skrive samme verdi om igjen.
      await this.setCapabilityValue(capability, value)
        .catch((error) => this.error(`Kunne ikke sette ${capability}`, error));
    }

    await this._applyWarnings(state);
    await this._applyInfo(state);
    await this._applyEnergy(state);
  }

  // Manifestet må oppgi batterier fordi alarm_battery brukes, og der står den
  // batteridrevne modellen med sine seks AA. De nettdrevne har bare tre, som
  // reserve — så de rettes opp her i stedet for å påstå dobbelt forbruk.
  async _applyEnergy(state) {
    const batteries = state.wired ? ['AA', 'AA', 'AA'] : ['AA', 'AA', 'AA', 'AA', 'AA', 'AA'];
    const current = this.getEnergy() || {};
    if (JSON.stringify(current.batteries) === JSON.stringify(batteries)) return;

    await this.setEnergy({ ...current, batteries })
      .catch((error) => this.error('Kunne ikke sette energiprofil', error));
  }

  // Varselnivået («heads up») har ingen capability, fordi Homey ikke skiller
  // det fra full alarm. Vi utløser flow-kortet på overgangen i stedet.
  async _applyWarnings(state) {
    const current = warnings(state);

    for (const hazard of ['smoke', 'co', 'heat']) {
      if (current[hazard] && !this._warnings[hazard]) {
        await this.homey.app.triggerWarning(this, hazard);
      }
    }

    this._warnings = current;
  }

  // Opplysninger som hører hjemme i enhetsinnstillingene, ikke som
  // capabilities: de endres nesten aldri og skal ikke lage grafer.
  async _applyInfo(state) {
    const wanted = {
      serial: state.id || '—',
      model: state.model || '—',
      power: state.wired ? 'wired' : 'battery',
      software: state.softwareVersion || '—',
      replaceBy: state.replaceBy ? state.replaceBy.slice(0, 10) : '—',
      lastTest: state.lastManualTest ? state.lastManualTest.slice(0, 10) : '—',
    };

    const changed = Object.entries(wanted)
      .filter(([key, value]) => this.getSetting(key) !== value);

    if (changed.length === 0) return;
    await this.setSettings(Object.fromEntries(changed))
      .catch((error) => this.error('Kunne ikke oppdatere enhetsinfo', error));
  }
}

module.exports = ProtectDevice;
