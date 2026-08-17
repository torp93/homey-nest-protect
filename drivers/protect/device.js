'use strict';

const Homey = require('homey');
const { toCapabilities, warnings } = require('../../lib/topaz');
const { capabilitiesFor } = require('../../lib/protect-config');

class ProtectDevice extends Homey.Device {
  async onInit() {
    this._id = String(this.getData().id);
    // Bevisst ukjent, ikke «alt rolig». Startet appen mens et varsel allerede
    // pågikk, ville alt-usant fått den første avlesningen til å se ut som en
    // ny overgang og utløst kortet uten at noe hadde skjedd.
    this._warnings = null;

    // Appen holder én forbindelse for alle enhetene. Vi lytter i stedet for å
    // hente selv.
    // Oppdateringene settes i kø. Kommer to påfølgende svar fra Nest tett nok,
    // ville to _apply-kjøringer overlappet — og siden varselsporingen leser og
    // skriver samme felt, kunne den ene låst seg til en foreldet verdi og
    // stilnet neste ekte varsel.
    this._chain = Promise.resolve();
    this._onStates = (states) => {
      this._chain = this._chain
        .then(() => this._apply(states))
        .catch((error) => this.error('Kunne ikke oppdatere', error));
    };

    this._onConnection = (connected) => {
      if (!connected) {
        this.setUnavailable(this.homey.__('error.disconnected'))
          .catch((error) => this.error('Kunne ikke merke enheten utilgjengelig', error));
        return;
      }
      // Tilkoblet igjen betyr ikke at akkurat denne varsleren er tilbake. Er
      // den fjernet fra Nest-kontoen, skal den forbli utilgjengelig i stedet
      // for å blinke tilgjengelig til neste avlesning oppdager det på nytt.
      if (this.homey.app.states().has(this._id)) {
        this.setAvailable()
          .catch((error) => this.error('Kunne ikke merke enheten tilgjengelig', error));
      }
    };

    this.homey.app.protect.on('states', this._onStates);
    this.homey.app.protect.on('connection', this._onConnection);

    // Appen kan ha hentet data — eller mistet forbindelsen — før enheten rakk
    // å starte. Uten dette går enheten glipp av en overgang som allerede har
    // skjedd, og blir stående tilgjengelig med gamle verdier mens appen i
    // virkeligheten ikke har kontakt.
    const known = this.homey.app.states();
    if (known.size > 0) this._onStates(known);
    else if (this.homey.app.isConnected() === false) this._onConnection(false);

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
    await this._migrate(state);

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

  // Enheter paret før en capability fantes får den lagt til her, i stedet for
  // at du må fjerne og pare dem på nytt — det ville tatt med seg flowene de
  // er brukt i.
  async _migrate(state) {
    for (const capability of capabilitiesFor(state)) {
      if (this.hasCapability(capability)) continue;
      await this.addCapability(capability)
        .then(() => this.log(`La til ${capability}`))
        .catch((error) => this.error(`Kunne ikke legge til ${capability}`, error));
    }
  }

  // Varselnivået («heads up») har ingen capability, fordi Homey ikke skiller
  // det fra full alarm. Vi utløser flow-kortet på overgangen i stedet.
  async _applyWarnings(state) {
    const current = warnings(state);

    // Første avlesning etter oppstart er et utgangspunkt, ikke en hendelse.
    if (this._warnings === null) {
      this._warnings = current;
      return;
    }

    for (const hazard of ['smoke', 'co', 'heat']) {
      const before = this._warnings[hazard];
      const now = current[hazard];

      // Bare en ekte overgang fra kjent rolig til varsel teller. Er noen av
      // dem ukjent, vet vi ikke om noe endret seg, og da varsler vi ikke.
      if (now === true && before === false) {
        await this.homey.app.triggerWarning(this, hazard);
      }

      // Ukjent nå betyr at vi beholder det vi visste sist, slik at et hull i
      // dataene ikke i seg selv blir en overgang neste runde.
      if (now !== null) this._warnings[hazard] = now;
    }
  }

  // Opplysninger som hører hjemme i enhetsinnstillingene, ikke som
  // capabilities: de endres nesten aldri og skal ikke lage grafer.
  async _applyInfo(state) {
    // Samme fem sjekker som Nest-appen viser under «Last checked», så de to
    // kan sammenlignes direkte når noe ser rart ut.
    // Tre utfall, ikke to. En sjekk Nest ikke har sagt noe om skal stå som
    // ukjent, ikke som bestått og ikke som feilet.
    const mark = (ok) => {
      if (ok === true) return `✓ ${this.homey.__('settings.ok')}`;
      if (ok === false) return `✗ ${this.homey.__('settings.failed')}`;
      return '—';
    };
    const checks = state.checks || {};

    // Lokal tid, ikke ISO. Denne leses av et menneske som vil vite om det var
    // nylig, ikke av en maskin.
    const when = (iso) => (iso
      ? new Date(iso).toLocaleString(this.homey.i18n.getLanguage() === 'no' ? 'nb-NO' : 'en-GB', {
        dateStyle: 'short', timeStyle: 'short', timeZone: this.homey.clock.getTimezone(),
      })
      : '—');

    const wanted = {
      serial: state.id || '—',
      model: state.model || '—',
      power: this.homey.__(state.wired ? 'settings.wired' : 'settings.battery'),
      software: state.softwareVersion || '—',
      replaceBy: state.replaceBy ? state.replaceBy.slice(0, 10) : '—',
      lastTest: when(state.lastManualTest),
      lastSelfTest: when(state.lastAudioSelfTest),
      reportedAt: when(state.reportedAt),
      checkSensors: mark(checks.sensors),
      checkAlarm: mark(checks.alarm),
      checkVoice: mark(checks.voice),
      checkBattery: mark(checks.battery),
      checkWifi: mark(checks.wifi),
    };

    const changed = Object.entries(wanted)
      .filter(([key, value]) => this.getSetting(key) !== value);

    if (changed.length === 0) return;
    await this.setSettings(Object.fromEntries(changed))
      .catch((error) => this.error('Kunne ikke oppdatere enhetsinfo', error));
  }
}

module.exports = ProtectDevice;
