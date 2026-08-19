'use strict';

const Homey = require('homey');
const {
  capabilitiesFor, readSettings, validate,
  SETTING_ISSUE_TOKEN, SETTING_COOKIE,
} = require('../../lib/protect-config');

// Varslerne finnes allerede i appens tilstand når paringen åpnes, siden løkka
// startet ved oppstart. Paringen henter derfor ikke noe selv — den venter bare
// på at den første hentingen skal være ferdig.
const WAIT_TIMEOUT_MS = 30000;

class ProtectDriver extends Homey.Driver {
  async onInit() {
    this.log('Nest Protect-driver startet');
  }

  // Reparasjon: ny innlogging mot Nest, startet fra enheten selv.
  //
  // Homey tilbyr Reparer når enheten er utilgjengelig, som er nettopp når
  // cookien har utløpt. Legitimasjonen er app-global, så dette gjenoppretter
  // alle varslerne samtidig — det står i visningen, slik at ingen tror de må
  // gjøre det sju ganger.
  async onRepair(session, device) {
    this.log(`Reparasjon startet fra ${device.getName()}`);

    // Begge verdiene fylles ut på forhånd. Første utgave lot cookie-feltet stå
    // tomt for å slippe å sende hemmeligheten ut i grensesnittet, men da så det
    // ut som om legitimasjonen var slettet — og et trykk på Lagre ga
    // «Cookien mangler», som forsterket inntrykket. Innstillingssiden viser
    // den likevel, så gevinsten var innbilt og forvirringen ekte.
    session.setHandler('getCredentials', async () => {
      const { issueToken, cookie } = readSettings(this.homey.settings);
      return { issueToken, cookie };
    });

    session.setHandler('testCredentials', async (input) => this.homey.app.testCredentials({
      issueToken: String((input && input.issueToken) || '').trim(),
      cookie: String((input && input.cookie) || '').trim(),
    }));

    session.setHandler('saveCredentials', async (input) => {
      const current = readSettings(this.homey.settings);
      const issueToken = String((input && input.issueToken) || '').trim() || current.issueToken;
      // Blankt felt betyr behold, ikke slett. En reparasjon skal aldri kunne
      // gjøre tilstanden verre enn den var da den ble åpnet.
      const cookie = String((input && input.cookie) || '').trim() || current.cookie;

      // Samme validering som appen selv bruker, så en avkortet innliming
      // stoppes her framfor å bli lagret og feile stille et minutt senere.
      const problems = validate({ issueToken, cookie });
      if (problems.length > 0) throw new Error(this.homey.__(`error.${problems[0]}`));

      await this.homey.settings.set(SETTING_ISSUE_TOKEN, issueToken);
      await this.homey.settings.set(SETTING_COOKIE, cookie);
      this.log('Ny legitimasjon lagret fra reparasjon');
      return { ok: true };
    });
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
