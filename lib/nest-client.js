'use strict';

// Klienten mot det gamle Nest-API-et. To kall bærer hele appen:
//
//   app_launch  henter alt på nytt og forteller hvilken transport-vert vi hører
//               til. Kjøres én gang ved oppstart.
//   subscribe   holder en forbindelse åpen til noe endrer seg. Dette er
//               grunnen til at appen finnes: alarmen kommer i samme sekund
//               varsleren uler, ikke ved neste polling.

const {
  NEST_HOST, USER_AGENT, NestAuthError, authenticate, needsRenewal,
} = require('./nest-auth');

// Bøttene vi ber om. `topaz` er varslerne, `where` er romnavnene Nest bruker
// når enheten ikke har fått et eget navn, og `structure` er husstanden.
const BUCKET_TYPES = ['topaz', 'where', 'structure'];

// Nest holder subscribe-forbindelsen åpen til noe skjer, og lukker den selv
// etter et par minutter hvis alt er stille. Vi gir den god margin over det og
// lar server-siden bestemme takten.
const SUBSCRIBE_TIMEOUT_MS = 600 * 1000;

class NestClient {
  constructor({
    issueToken, cookie, log = () => {}, onCredentials = null,
  }) {
    this._issueToken = issueToken;
    this._cookie = cookie;
    this._log = log;
    // Cookien roteres av Google ved hver innlogging. Appen lagrer den tilbake
    // til innstillingene gjennom dette kallet.
    this._onCredentials = onCredentials;
    this._session = null;
  }

  get userId() {
    return this._session ? this._session.userId : null;
  }

  get transportUrl() {
    return this._session ? this._session.transportUrl : null;
  }

  // Gyldig økt, eller en ny. Alle kall går gjennom denne.
  async session() {
    if (this._session && !needsRenewal(this._session.expiresAt)) return this._session;

    this._log('Autentiserer mot Nest');
    const session = await authenticate(this._issueToken, this._cookie);
    this._session = session;

    if (session.cookie !== this._cookie) {
      this._cookie = session.cookie;
      // Uten dette overlever ikke innloggingen en omstart: den lagrede cookien
      // ville vært flere rotasjoner bak.
      if (this._onCredentials) await this._onCredentials({ cookie: session.cookie });
    }

    // Verten logges fordi Nest flytter oss mellom dem og det er nyttig ved
    // feilsøking. Bruker-id-en holdes utenfor: den identifiserer kontoen, og
    // logger havner i feilrapporter.
    this._log(`Innlogget mot ${session.transportUrl}`);
    return session;
  }

  // Tvinger ny innlogging ved neste kall. Brukes når API-et svarer 401 midt i
  // en økt, som skjer når Google trekker tokenet før utløpstiden.
  invalidate() {
    this._session = null;
  }

  async _post(url, body, { timeoutMs = 30000 } = {}) {
    const session = await this.session();

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${session.jwt}`,
        'Content-Type': 'application/json',
        'User-Agent': USER_AGENT,
        'X-nl-user-id': session.userId,
        'X-nl-protocol-version': '1',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });

    return { response, session };
  }

  // Alt på nytt. Returnerer bøttene og oppdaterer transport-verten, som Nest
  // kan flytte oss til uten forvarsel.
  async appLaunch({ bucketTypes = BUCKET_TYPES, timeoutMs = 30000 } = {}) {
    const session = await this.session();
    const url = `${NEST_HOST}/api/0.1/user/${session.userId}/app_launch`;

    const { response } = await this._post(url, {
      known_bucket_types: bucketTypes,
      known_bucket_versions: [],
    }, { timeoutMs });

    if (response.status === 401) {
      this.invalidate();
      throw new NestAuthError('Nest rejected the request; the session is no longer valid', {
        status: 401, step: 'app_launch', retryable: true,
      });
    }

    if (!response.ok) {
      throw new Error(`Fetching devices from Nest failed (HTTP ${response.status})`);
    }

    // Et 200-svar som ikke er JSON — en feilside fra en mellomliggende proxy,
    // for eksempel — skal bli en forståelig feil og ikke en rå SyntaxError i
    // paringsdialogen.
    const body = await response.json().catch(() => null);
    if (!body) throw new Error('Nest returned an unreadable response');

    const buckets = body.updated_buckets || [];

    // Transport-verten kommer herfra og kan avvike fra den /session ga.
    const transportUrl = body.service_urls
      && body.service_urls.urls
      && body.service_urls.urls.transport_url;

    if (transportUrl && transportUrl !== this._session.transportUrl) {
      this._log(`Transport flyttet til ${transportUrl}`);
      this._session = { ...this._session, transportUrl };
    }

    this._log(`app_launch ga ${buckets.length} bøtte(r)`);
    return buckets;
  }

  // Venter til noe endrer seg. Nest sammenligner revisjonene vi sender inn med
  // sine egne og svarer først når de spriker, eller lukker stille ved timeout.
  //
  // Returnerer endrede bøtter, eller en tom liste når ingenting skjedde. Den
  // som kaller skal kalle igjen umiddelbart med oppdaterte revisjoner.
  async subscribe(objects, { timeoutMs = SUBSCRIBE_TIMEOUT_MS, signal = null } = {}) {
    const session = await this.session();

    let response;
    try {
      response = await fetch(`${session.transportUrl}/v6/subscribe`, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${session.jwt}`,
          'Content-Type': 'application/json',
          'User-Agent': USER_AGENT,
          'X-nl-user-id': session.userId,
          'X-nl-protocol-version': '1',
        },
        body: JSON.stringify({ objects }),
        signal: signal || AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      // Et tidsavbrudd her betyr at det var stille lenge nok, ikke at noe er
      // galt. Behandles det som feil, slutter appen å lytte hver gang huset
      // står tomt en stund — altså akkurat når den skal være mest pålitelig.
      if (error.name === 'TimeoutError') return { buckets: [], timedOut: true };
      // Et avbrudd vi selv ba om er heller ingen feil: det er slik en tvungen
      // innhenting bryter inn i en forbindelse som ellers ville stått i ti
      // minutter til.
      if (error.name === 'AbortError') return { buckets: [], aborted: true };
      throw error;
    }

    // Nest svarer 401 når JWT-et er utløpt under ventingen. Det er normalt ved
    // lange forbindelser, ikke en feil verdt å varsle brukeren om.
    if (response.status === 401) {
      this.invalidate();
      return { buckets: [], reauthenticated: true };
    }

    // Tomt svar betyr at ingenting endret seg innen tidsfristen.
    if (response.status === 304 || response.status === 204) {
      return { buckets: [], reauthenticated: false };
    }

    if (!response.ok) {
      throw new Error(`Listening for changes from Nest failed (HTTP ${response.status})`);
    }

    // En kropp vi ikke kan lese er ikke «ingenting endret seg». Ble den
    // svelget, ville appen meldt seg frisk og latt gamle faredata stå som om
    // de var ferske — en feilside fra en mellomliggende proxy ville sett
    // nøyaktig ut som et rolig hus. Vi kaster i stedet, slik at løkka merker
    // enhetene utilgjengelige og går i backoff.
    //
    // Selve kroppen tas aldri med i feilen: den kan inneholde hva som helst,
    // og feilteksten havner i logg og i innstillingssiden.
    let body;
    try {
      body = await response.json();
    } catch (error) {
      throw new Error('Nest returned an unreadable response while listening for changes');
    }

    if (!body || typeof body !== 'object') {
      throw new Error('Nest returned an unexpected response while listening for changes');
    }

    return { buckets: Array.isArray(body.objects) ? body.objects : [], reauthenticated: false };
  }
}

// Revisjonslista subscribe skal ha. Nest vil ha alle tre feltene; utelates
// timestamp svarer den umiddelbart med alt, og vi ender i en tett løkke.
function subscribeObjects(buckets) {
  return buckets.map((bucket) => ({
    object_key: bucket.object_key,
    object_revision: bucket.object_revision,
    object_timestamp: bucket.object_timestamp,
  }));
}

// Slår endrede bøtter inn over de kjente. Nest sender bare det som er endret,
// så uten dette mister vi alt vi ikke fikk i siste svar.
function mergeBuckets(known, changed) {
  const merged = new Map(known.map((bucket) => [bucket.object_key, bucket]));

  for (const bucket of changed) {
    const prev = merged.get(bucket.object_key);
    // Feltene slås sammen, ikke bøttene byttes ut. Sender Nest en delvis
    // oppdatering med bare noen få felt, ville en ren erstatning fjernet alt
    // det andre — og en manglende smoke_status leses som ukjent, altså ville
    // en levende alarm forsvunnet fra Homey.
    merged.set(bucket.object_key, {
      ...prev,
      ...bucket,
      value: { ...(prev && prev.value), ...bucket.value },
    });
  }

  return [...merged.values()];
}

module.exports = {
  NestClient,
  BUCKET_TYPES,
  SUBSCRIBE_TIMEOUT_MS,
  subscribeObjects,
  mergeBuckets,
};
