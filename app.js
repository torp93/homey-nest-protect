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

// Hvor lenge forbindelsen må være nede før det er verdt å vekke noen. Et
// kritisk varsel skal bety «gjør noe nå», og et nettverkshikk på fem sekunder
// gjør ikke det — kommer de for ofte, slutter man å reagere på dem, og da
// virker de ikke den dagen det gjelder. Appen fornyer innloggingen omtrent
// hvert 50. minutt, så et brudd som overlever en time har overlevd appens eget
// forsøk på å reparere seg selv.
const OFFLINE_ALERT_MS = 60 * 60 * 1000;

// Hvor lenge vi venter før vi prøver på nytt etter at Google har avvist
// innloggingen. Lenge, fordi en trukket cookie ikke fikser seg selv og det
// ikke er noe poeng i å mase. Men ikke aldri: en 401 kan også komme av at
// Google strammer inn et øyeblikk, og en app som gir opp for godt på grunn av
// det er ubrukelig som røykvarsler.
const REAUTH_RETRY_MS = 30 * 60 * 1000;

// Hvor mange feil på rad før vi mistenker at det ikke er nettverket, men
// adressen vi ringer. Nest flytter transport-verten mellom czfeNN-maskiner
// uten forvarsel, og en subscribe mot en vert som er tatt ut av drift feiler
// like trofast hver gang. Uten dette prøver appen mot den samme døde adressen
// helt til den timeplanlagte app_launch kommer og gir oss en ny — opptil en
// time senere.
const RELAUNCH_AFTER_FAILURES = 3;

// Korteste tid mellom to subscribe-runder. Normalt henger forespørselen åpen i
// minutter, men den kan også returnere med en gang — ved tidsavbrudd, avbrudd,
// utløpt økt eller et tomt svar. Uten en bunn her ville løkka i den situasjonen
// spinne så fort maskinen orker og hamre Nest.
const MIN_SUBSCRIBE_GAP_MS = 2000;

// Hvor lenge vi venter når kontoen svarer riktig, men ikke har noen Protect.
// Uten dette ville løkka kalt app_launch om og om igjen uten pause, fordi
// «ingen bøtter» ser ut som «ikke hentet ennå».
const EMPTY_ACCOUNT_RETRY_MS = 5 * 60 * 1000;

// Hvor lenge vi selv lar en subscribe stå før vi bryter den. Nest lukker
// vanligvis først, men uten en egen frist kan en forbindelse som verken svarer
// eller lukkes bli hengende til undici gir opp — og da som en uventet feil i
// stedet for en normal runde.
const SUBSCRIBE_DEADLINE_MS = 4 * 60 * 1000;

// Hvor mange ganger på rad Nest får be om ny innlogging før vi regner det som
// en feil og går i backoff. Én er normalt når et JWT utløper midt i en åpen
// forbindelse; flere på rad betyr at noe ikke fester seg.
const MAX_CONSECUTIVE_REAUTHS = 3;

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
    // Ukjent, ikke frakoblet. Startet vi med `false`, ville den aller første
    // mislykkede tilkoblingen ikke telle som en overgang — setConnected
    // returnerer tidlig på uendret verdi. Da ble enhetene aldri merket
    // utilgjengelige, timeren for frakoblet-varsel ble aldri startet, og
    // varslerne ble stående med sist lagrede verdier som om alt var i orden.
    // Nettopp den situasjonen oppstår når cookien er utløpt og Homey starter
    // på nytt.
    this._connected = null;
    this._lastError = null;
    this._lastUpdate = null;
    this._offlineTimer = null;
    this._offlineSince = null;
    this._offlineReported = false;
    this._stopped = false;
    this._launchedAt = 0;
    this._reauths = 0;

    this.registerFlowCards();

    // Nye verdier krever ny innlogging. Vi river ned og bygger opp igjen i
    // stedet for å forsøke å reparere en økt som tilhører en annen konto.
    this.homey.settings.on('set', (key) => {
      if (key !== SETTING_ISSUE_TOKEN && key !== SETTING_COOKIE) return;
      // Vår egen roterte cookie er ikke en endring brukeren gjorde, og skal
      // ikke rive ned en fungerende økt.
      if (key === SETTING_COOKIE
        && this.homey.settings.get(SETTING_COOKIE) === this._writtenCookie) return;
      this.restart();
    });

    this.start();
    this.log(`Nest Protect v${this.manifest.version} startet`);
  }

  async onUninit() {
    this._stopped = true;
    if (this._abort) this._abort.abort();
    if (this._offlineTimer) this.homey.clearTimeout(this._offlineTimer);
    if (this._sleepTimer) this.homey.clearTimeout(this._sleepTimer);
    this.wake();
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
        // Verdien huskes slik at lytteren kan kjenne igjen vår egen skriving.
        // Et flagg rundt await-en holdt ikke: hendelsen kommer når den kommer,
        // og hadde flagget rukket å bli falskt igjen, ville appen startet på
        // nytt hver gang Google roterte cookien — altså ved hver innlogging.
        this._writtenCookie = rotated;
        await this.homey.settings.set(SETTING_COOKIE, rotated);
        this.log('Cookie rotert av Google og lagret');
      },
    });

    return this._client;
  }

  // Tvungen ny innhenting. Uten denne må man vente på at Nest sender noe av
  // seg selv, og det kan ta timer når alt er i orden — som er nettopp når man
  // vil forsikre seg om at kjeden virker.
  async refreshNow() {
    this._launchedAt = 0;
    // Bryter en subscribe som ellers kunne stått i minutter til, og vekker
    // løkka hvis den sover i et gjenforsøksintervall.
    if (this._abort) this._abort.abort();
    this.wake();
    this.log('Tvungen innhenting bestilt');
  }

  restart() {
    this.log('Innstillinger endret — kobler til på nytt');
    this._client = null;
    this._buckets = [];
    this._launchedAt = 0;
    this._reauths = 0;

    // Nye innstillinger kan peke på en annen Nest-konto. Da hører hverken
    // enhetene eller romnavnene hjemme lenger, og de må ut før den nye
    // hentingen kommer — ellers ville en varsler fra forrige konto stått
    // igjen som tilgjengelig med sine gamle verdier.
    this._states = new Map();
    this._whereMap = new Map();
    this._lastUpdate = null;
    this.protect.emit('states', this._states);
    if (this._abort) this._abort.abort();
    // Nye verdier skal virke med en gang, ikke etter at et halvtimes
    // gjenforsøksintervall har gått ut.
    this.wake();
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
          // En konto uten Protect er ikke en feil, men den må ikke bli en tett
          // løkke: uten bøtter treffer vi denne grenen igjen med en gang.
          if (this._buckets.length === 0) {
            this.setConnected(true);
            await this._sleep(EMPTY_ACCOUNT_RETRY_MS);
            continue;
          }
        } else {
          const started = Date.now();
          await this._listen(client);
          const elapsed = Date.now() - started;
          if (elapsed < MIN_SUBSCRIBE_GAP_MS) await this._sleep(MIN_SUBSCRIBE_GAP_MS - elapsed);
        }

        attempt = 0;
        this.setConnected(true);
      } catch (error) {
        attempt += 1;
        this.setConnected(false, error);

        // En trukket eller utløpt cookie løser seg sjelden ved å prøve igjen
        // med en gang, så vi venter lenge. Men vi gir aldri helt opp: en app
        // som stopper for godt fordi Google svarte 401 én gang, er en app som
        // stille slutter å varsle om brann. Klienten nullstilles så
        // innstillingene leses på nytt — kanskje har de blitt fikset i mellomtiden.
        if (error instanceof NestAuthError && error.retryable === false) {
          this.error(
            `Google avviste innloggingen (${error.message}). `
            + `Nytt forsøk om ${REAUTH_RETRY_MS / 60000} min.`,
          );
          this._client = null;
          attempt = 0;
          await this._sleep(REAUTH_RETRY_MS);
          continue;
        }

        // Etter noen feil på rad slutter vi å stole på transport-verten og
        // henter alt på nytt. app_launch gir en fersk adresse, og det er den
        // eneste veien ut når den gamle er tatt ut av drift.
        if (attempt >= RELAUNCH_AFTER_FAILURES && this._launchedAt !== 0) {
          this.error(`${attempt} feil på rad — henter ny transport-vert ved neste forsøk`);
          this._launchedAt = 0;
          // Klienten finnes ikke hvis feilen kom av manglende innstillinger.
          if (this._client) this._client.invalidate();
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
    // subscribe som ellers ville hengt i minutter til. Fristen legges på vår
    // egen kontroller, ikke som et konkurrerende signal: klienten bruker det
    // vi sender inn i stedet for sitt eget, så uten dette hadde ingen frist
    // vært i kraft i det hele tatt.
    this._abort = new AbortController();
    const deadline = this.homey.setTimeout(() => this._abort.abort(), SUBSCRIBE_DEADLINE_MS);

    let result;
    try {
      result = await client.subscribe(subscribeObjects(this._buckets), {
        signal: this._abort.signal,
      });
    } finally {
      this.homey.clearTimeout(deadline);
    }

    if (result.timedOut || result.aborted) return;

    if (result.reauthenticated) {
      this._reauths += 1;
      // Én ny innlogging er normalt: JWT-et varer en time, og en subscribe kan
      // stå åpen når den utløper. Flere på rad betyr at innloggingen ikke
      // fester seg, og da må det behandles som en feil — ellers blir det en
      // løkke av innlogginger med bare sekunder mellom.
      if (this._reauths >= MAX_CONSECUTIVE_REAUTHS) {
        throw new Error(`Nest keeps rejecting the session (${this._reauths} times in a row)`);
      }
      this.log('Økten utløp under lytting — logger inn på nytt');
      return;
    }

    this._reauths = 0;
    if (result.buckets.length === 0) return;

    this._buckets = mergeBuckets(this._buckets, result.buckets);
    this.log(`${result.buckets.length} endring(er) mottatt`);
    this.publish();
  }

  // Ventingen kan avbrytes. Uten det ville nye innstillinger eller et trykk på
  // «hent nå» blitt liggende ubrukt i opptil en halvtime, fordi løkka sov i
  // gjenforsøksintervallet etter en avvist innlogging.
  _sleep(ms) {
    return new Promise((resolve) => {
      this._wake = () => {
        this.homey.clearTimeout(this._sleepTimer);
        this._sleepTimer = null;
        this._wake = null;
        resolve();
      };
      this._sleepTimer = this.homey.setTimeout(() => {
        this._sleepTimer = null;
        this._wake = null;
        resolve();
      }, ms);
    });
  }

  wake() {
    if (this._wake) this._wake();
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

  // true, false, eller null før første forsøk er gjort. Enhetene spør om denne
  // når de starter, siden de ellers går glipp av en tilkoblingsovergang som
  // skjedde før de rakk å lytte.
  isConnected() {
    return this._connected;
  }

  setConnected(connected, error = null) {
    this._lastError = connected ? null : (error && error.message) || 'unknown error';
    if (this._connected === connected) return;

    this._connected = connected;
    this.log(connected ? 'Tilkoblet Nest' : `Mistet forbindelsen: ${this._lastError}`);

    // Enhetene merkes utilgjengelige med en gang. Det er en stille beskjed i
    // grensesnittet, ikke et varsel, og da er øyeblikkelig riktig.
    this.protect.emit('connection', connected);

    if (connected) this._connectionRestored();
    else this._connectionLost();
  }

  _connectionLost() {
    if (this._offlineTimer) return;

    this._offlineSince = Date.now();
    this._offlineTimer = this.homey.setTimeout(() => {
      this._offlineTimer = null;
      // Kan ha kommet seg i mellomtiden uten at timeren ble ryddet.
      if (this._connected) return;

      this._offlineReported = true;
      this.log(`Fortsatt frakoblet etter ${Math.round(OFFLINE_ALERT_MS / 60000)} min — varsler`);
      this._connectionTrigger
        .trigger({}, { state: 'offline' })
        .catch((err) => this.error('Kunne ikke utløse tilkoblingskort', err));
    }, OFFLINE_ALERT_MS);
  }

  _connectionRestored() {
    if (this._offlineTimer) {
      this.homey.clearTimeout(this._offlineTimer);
      this._offlineTimer = null;
    }

    const downMs = this._offlineSince ? Date.now() - this._offlineSince : 0;
    this._offlineSince = null;

    // Bare hvis du faktisk ble varslet om bruddet. En gladmelding om et
    // problem man aldri hørte om er bare støy.
    if (!this._offlineReported) {
      if (downMs > 0) this.log(`Kom tilbake etter ${Math.round(downMs / 1000)}s — ikke verdt et varsel`);
      return;
    }

    this._offlineReported = false;
    this._connectionTrigger
      .trigger({}, { state: 'online' })
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
      // Siden varselet er forsinket, må siden kunne vise at noe er galt akkurat
      // nå selv om telefonen ennå ikke har fått beskjed.
      offlineSince: this._offlineSince ? new Date(this._offlineSince).toISOString() : null,
      offlineReported: this._offlineReported,
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
      // Eksplisitt boolsk: tilstanden er ukjent til første forsøk er gjort, og
      // et flow-kort skal ikke få null tilbake.
      .registerRunListener(() => this._connected === true);

    this.homey.flow
      .getActionCard('refresh_now')
      .registerRunListener(() => this.refreshNow());

    // Varselnivået har ingen capability å henge på, siden Homey ikke skiller
    // «nesten» fra «nå». Enheten utløser kortet selv når nivået endrer seg.
    // getDeviceTriggerCard, ikke getTriggerCard: kortet har et device-argument
    // i manifestet, og Homey velger kortklasse etter hvilken henter som
    // brukes — ikke etter manifestet. Som vanlig trigger blir signaturen
    // trigger(tokens, state), så enheten havnet i tokens, state ble tomt, og
    // farevalget forsvant. Kortet kunne dermed aldri fyre, stille.
    this._warningTrigger = this.homey.flow.getDeviceTriggerCard('hazard_warning');
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
