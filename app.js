'use strict';

const Homey = require('homey');
const EventEmitter = require('events');

const { NestClient, subscribeObjects, mergeBuckets } = require('./lib/nest-client');
const { NestAuthError } = require('./lib/nest-auth');
const { parseTopaz } = require('./lib/topaz');
const { buildWhereMap, deviceLabel, whereIdOf } = require('./lib/where');
const {
  SETTING_ISSUE_TOKEN, SETTING_COOKIE, readSettings, validate, backoffMs,
} = require('./lib/protect-config');

// Navnene og romstrukturen endres sjelden, men de endres. En hel ny henting i
// timen koster lite og fanger opp varslere som er lagt til eller flyttet.
const RELAUNCH_INTERVAL_MS = 60 * 60 * 1000;

class NestProtectApp extends Homey.App {
  async onInit() {
    // Én forbindelse for hele appen. Sju enheter som hver holdt sin egen
    // subscribe åpen ville vært sju ganger belastningen for samme svar.
    this.protect = new EventEmitter();
    this.protect.setMaxListeners(0);

    this._client = null;
    this._buckets = [];
    this._whereMap = new Map();
    this._states = new Map();
    this._connected = false;
    this._lastError = null;
    this._lastUpdate = null;
    this._stopped = false;
    this._launchedAt = 0;

    this.registerFlowCards();

    // Nye verdier krever ny innlogging. Vi river ned og bygger opp igjen i
    // stedet for å forsøke å reparere en økt som tilhører en annen konto.
    this.homey.settings.on('set', (key) => {
      if (key === SETTING_ISSUE_TOKEN || key === SETTING_COOKIE) this.restart();
    });

    this.start();
    this.log(`Nest Protect v${this.manifest.version} startet`);
  }

  async onUninit() {
    this._stopped = true;
    if (this._abort) this._abort.abort();
  }

  // ---- tilkobling ----

  client() {
    if (this._client) return this._client;

    const { issueToken, cookie } = readSettings(this.homey.settings);
    const problems = validate({ issueToken, cookie });
    if (problems.length > 0) throw new Error(this.homey.__(`error.${problems[0]}`));

    this._client = new NestClient({
      issueToken,
      cookie,
      log: (...args) => this.log('[nest]', ...args),
      // Google roterer cookien ved hver innlogging. Uten at den skrives
      // tilbake, overlever ikke innloggingen en omstart av appen.
      onCredentials: async ({ cookie: rotated }) => {
        // Sett direkte, ikke gjennom lytteren over: dette er samme økt, og en
        // omstart her ville gitt en løkke av innlogginger.
        this._suppressRestart = true;
        await this.homey.settings.set(SETTING_COOKIE, rotated);
        this._suppressRestart = false;
        this.log('Cookie rotert av Google og lagret');
      },
    });

    return this._client;
  }

  restart() {
    if (this._suppressRestart) return;
    this.log('Innstillinger endret — kobler til på nytt');
    this._client = null;
    this._buckets = [];
    this._launchedAt = 0;
    if (this._abort) this._abort.abort();
  }

  start() {
    if (this._loop) return;
    this._loop = this._run().catch((error) => this.error('Løkka stoppet uventet', error));
  }

  // Hovedløkka. Henter alt én gang, og henger deretter på subscribe som svarer
  // i det øyeblikket noe endrer seg. Alt annet i appen er lyttere på denne.
  async _run() {
    let attempt = 0;

    while (!this._stopped) {
      try {
        const client = this.client();

        const stale = Date.now() - this._launchedAt > RELAUNCH_INTERVAL_MS;
        if (this._buckets.length === 0 || stale) {
          await this._launch(client);
        } else {
          await this._listen(client);
        }

        attempt = 0;
        this.setConnected(true);
      } catch (error) {
        attempt += 1;
        this.setConnected(false, error);

        // En trukket eller utløpt cookie løser seg ikke ved å prøve igjen.
        // Appen legger seg til å vente på nye innstillinger i stedet for å
        // hamre på Google, slik forgjengeren gjorde i timevis.
        if (error instanceof NestAuthError && error.retryable === false) {
          this.error('Innloggingen er ikke lenger gyldig — venter på nye verdier', error.message);
          return;
        }

        const wait = backoffMs(attempt);
        this.error(`Forsøk ${attempt} feilet (${error.message}) — nytt forsøk om ${wait / 1000}s`);
        await this._sleep(wait);
      }
    }
  }

  async _launch(client) {
    const all = await client.appLaunch();
    this._whereMap = buildWhereMap(all);
    this._buckets = all.filter((b) => String(b.object_key || '').startsWith('topaz.'));
    this._launchedAt = Date.now();
    this.log(`Hentet ${this._buckets.length} varsler(e)`);
    this.publish();
  }

  async _listen(client) {
    // Egen abort-kontroller slik at endrede innstillinger kan bryte en
    // subscribe som ellers ville hengt i ti minutter til.
    this._abort = new AbortController();

    const result = await client.subscribe(subscribeObjects(this._buckets), {
      signal: this._abort.signal,
    });

    if (result.timedOut) return;
    if (result.reauthenticated) {
      this.log('Økten utløp under lytting — logger inn på nytt');
      return;
    }
    if (result.buckets.length === 0) return;

    this._buckets = mergeBuckets(this._buckets, result.buckets);
    this.log(`${result.buckets.length} endring(er) mottatt`);
    this.publish();
  }

  _sleep(ms) {
    return new Promise((resolve) => this.homey.setTimeout(resolve, ms));
  }

  // ---- tilstand ut til enhetene ----

  publish() {
    this._states = new Map();

    for (const bucket of this._buckets) {
      const state = parseTopaz(bucket);
      if (!state.id) continue;
      this._states.set(state.id, {
        state,
        label: deviceLabel(state, this._whereMap, whereIdOf(bucket)),
      });
    }

    this._lastUpdate = new Date().toISOString();
    this.protect.emit('states', this._states);
  }

  states() {
    return this._states;
  }

  setConnected(connected, error = null) {
    this._lastError = connected ? null : (error && error.message) || 'ukjent feil';
    if (this._connected === connected) return;

    this._connected = connected;
    this.log(connected ? 'Tilkoblet Nest' : `Mistet forbindelsen: ${this._lastError}`);

    this.protect.emit('connection', connected);
    this._connectionTrigger
      .trigger({}, { state: connected ? 'online' : 'offline' })
      .catch((err) => this.error('Kunne ikke utløse tilkoblingskort', err));
  }

  // Alt innstillingssiden trenger, i ett kall.
  status() {
    const { issueToken, cookie } = readSettings(this.homey.settings);

    return {
      configured: validate({ issueToken, cookie }).length === 0,
      problems: validate({ issueToken, cookie }),
      connected: this._connected,
      lastError: this._lastError,
      lastUpdate: this._lastUpdate,
      devices: [...this._states.values()].map(({ state, label }) => ({
        id: state.id,
        label,
        model: state.model,
        wired: state.wired,
        voltage: state.batteryMillivolt ? state.batteryMillivolt / 1000 : null,
        replaceBy: state.replaceBy,
      })),
    };
  }

  // Brukes av innstillingssiden før lagring, slik at brukeren får vite med en
  // gang om verdiene duger i stedet for å lure på hvorfor det er stille.
  async testCredentials({ issueToken, cookie }) {
    const problems = validate({ issueToken, cookie });
    if (problems.length > 0) throw new Error(this.homey.__(`error.${problems[0]}`));

    const client = new NestClient({ issueToken, cookie });
    const buckets = await client.appLaunch();
    const protects = buckets.filter((b) => String(b.object_key || '').startsWith('topaz.'));

    return { deviceCount: protects.length };
  }

  registerFlowCards() {
    this._connectionTrigger = this.homey.flow.getTriggerCard('connection_changed');
    this._connectionTrigger.registerRunListener(
      (args, state) => args.connection_state === state.state,
    );

    this.homey.flow
      .getConditionCard('is_connected')
      .registerRunListener(() => this._connected);

    // Varselnivået har ingen capability å henge på, siden Homey ikke skiller
    // «nesten» fra «nå». Enheten utløser kortet selv når nivået endrer seg.
    this._warningTrigger = this.homey.flow.getTriggerCard('hazard_warning');
    this._warningTrigger.registerRunListener(
      (args, state) => args.hazard === state.hazard,
    );
  }

  triggerWarning(device, hazard) {
    return this._warningTrigger
      .trigger(device, {}, { hazard })
      .catch((error) => this.error('Kunne ikke utløse varselkort', error));
  }
}

module.exports = NestProtectApp;
