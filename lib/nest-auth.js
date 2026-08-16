'use strict';

// Innlogging mot det gamle Nest-API-et. Google fjernet API-nøkler, så eneste
// vei inn er en øktcookie fra en innlogget nettleser pluss den issueToken-URL-en
// home.nest.com selv kaller. Begge må brukeren hente ut manuelt fra DevTools.
//
// Kjeden er tre steg, og hvert av dem kan feile på sin egen måte:
//   1. issueToken + cookie  ->  Google access token   (60 min)
//   2. access token         ->  Nest JWT              (60 min)
//   3. JWT                  ->  økt mot home.nest.com
//
// Bygget etter iMicknl/ha-nest-protect (MIT), som igjen bygger på
// chrisjshull/homebridge-nest. Endepunktene er udokumenterte og kan forsvinne
// uten varsel.

const NEST_AUTH_URL_JWT = 'https://nestauthproxyservice-pa.googleapis.com/v1/issue_jwt';
const NEST_HOST = 'https://home.nest.com';

// Google avviser forespørsler uten en nettleseraktig User-Agent på issueToken.
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) '
  + 'AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// Tokenet varer en time. Vi fornyer med god margin, ikke fordi det haster, men
// fordi en subscribe-forbindelse kan stå åpen i ti minutter og ikke bør ryke
// midt i en alarm.
const TOKEN_LIFETIME_MS = 3600 * 1000;
const RENEW_MARGIN_MS = 10 * 60 * 1000;

class NestAuthError extends Error {
  constructor(message, { status = null, step = null, retryable = true } = {}) {
    super(message);
    this.name = 'NestAuthError';
    this.status = status;
    this.step = step;
    // Et utløpt eller trukket samtykke løser seg ikke ved å prøve igjen. Da
    // skal appen si fra til brukeren i stedet for å hamre på Google, slik den
    // gamle appen gjorde i mars: 20 sekunders retry i timevis.
    this.retryable = retryable;
  }
}

// 401 og 403 betyr at cookien ikke lenger gjelder. Alt annet kan være
// forbigående: nettverk, rate limiting, en dårlig dag hos Google.
function classify(status) {
  return status !== 401 && status !== 403;
}

async function postForm(url, form, headers, timeoutMs) {
  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...headers },
    body: new URLSearchParams(form).toString(),
    signal: AbortSignal.timeout(timeoutMs),
  });
}

// Steg 1. Cookien byttes mot et Google access token. Svaret setter også nye
// cookieverdier, og de må tas vare på: Google roterer __Secure-3PSIDCC ved hver
// henting, og en klient som fortsetter med den gamle blir logget ut etter noen
// runder.
async function fetchAccessToken(issueToken, cookie, { timeoutMs = 15000 } = {}) {
  let response;
  try {
    response = await fetch(issueToken, {
      headers: {
        'User-Agent': USER_AGENT,
        'Sec-Fetch-Mode': 'cors',
        'X-Requested-With': 'XmlHttpRequest',
        Referer: 'https://accounts.google.com/o/oauth2/iframe',
        cookie,
      },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    throw new NestAuthError(`Fikk ikke kontakt med Google: ${error.message}`, { step: 'token' });
  }

  if (!response.ok) {
    throw new NestAuthError(
      `Google avviste issueToken (HTTP ${response.status})`,
      { status: response.status, step: 'token', retryable: classify(response.status) },
    );
  }

  const body = await response.json().catch(() => ({}));

  // Google svarer 200 med en feilkropp når samtykket er trukket. Å stole på
  // statuskoden alene ville gitt en tom økt som ser vellykket ut.
  if (!body.access_token) {
    throw new NestAuthError(
      `Google ga ikke noe access token${body.error ? `: ${body.error}` : ''}`,
      { step: 'token', retryable: false },
    );
  }

  return {
    accessToken: body.access_token,
    cookie: mergeCookies(cookie, response.headers.getSetCookie()),
    expiresAt: Date.now() + (Number(body.expires_in) || 3600) * 1000,
  };
}

// Set-Cookie fra Google inneholder bare de verdiene som er endret. Resten av
// den opprinnelige strengen må bli stående, ellers mister vi __Secure-3PSID.
function mergeCookies(cookie, setCookieHeaders = []) {
  const jar = new Map();

  for (const part of String(cookie).split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    jar.set(part.slice(0, index).trim(), part.slice(index + 1).trim());
  }

  for (const header of setCookieHeaders) {
    // Første segment er selve verdien; resten er Path, Domain, Expires og
    // andre attributter vi ikke sender tilbake.
    const [pair] = String(header).split(';');
    const index = pair.indexOf('=');
    if (index === -1) continue;

    const name = pair.slice(0, index).trim();
    const value = pair.slice(index + 1).trim();
    // Google sletter en cookie ved å sette den tom. Da skal den ut av krukka,
    // ikke stå igjen som «navn=».
    if (value === '' || value === '""') jar.delete(name);
    else jar.set(name, value);
  }

  return [...jar].map(([name, value]) => `${name}=${value}`).join('; ');
}

// Steg 2. Access tokenet byttes mot et Nest-JWT. Det er dette som brukes som
// Basic-auth mot selve API-et.
async function fetchJwt(accessToken, { timeoutMs = 15000 } = {}) {
  let response;
  try {
    response = await postForm(NEST_AUTH_URL_JWT, {
      embed_google_oauth_access_token: true,
      expire_after: '3600s',
      google_oauth_access_token: accessToken,
      policy_id: 'authproxy-oauth-policy',
    }, {
      Authorization: `Bearer ${accessToken}`,
      'User-Agent': USER_AGENT,
      Referer: NEST_HOST,
    }, timeoutMs);
  } catch (error) {
    throw new NestAuthError(`Fikk ikke kontakt med Nest authproxy: ${error.message}`, { step: 'jwt' });
  }

  if (!response.ok) {
    throw new NestAuthError(
      `Nest authproxy avviste tokenet (HTTP ${response.status})`,
      { status: response.status, step: 'jwt', retryable: classify(response.status) },
    );
  }

  const body = await response.json().catch(() => ({}));
  if (!body.jwt) throw new NestAuthError('Nest authproxy ga ikke noe JWT', { step: 'jwt' });

  return { jwt: body.jwt, claims: body.claims || null };
}

// Steg 3. Økten forteller hvilken bruker JWT-et tilhører. Bruker-id-en trengs
// i alle senere kall, og den er ikke den samme som Google-kontoen din.
async function fetchSession(jwt, { timeoutMs = 15000 } = {}) {
  let response;
  try {
    response = await fetch(`${NEST_HOST}/session`, {
      headers: {
        Authorization: `Basic ${jwt}`,
        'User-Agent': USER_AGENT,
        cookie: `user_token=${jwt}`,
      },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    throw new NestAuthError(`Fikk ikke kontakt med ${NEST_HOST}: ${error.message}`, { step: 'session' });
  }

  if (!response.ok) {
    throw new NestAuthError(
      `Nest avviste økten (HTTP ${response.status})`,
      { status: response.status, step: 'session', retryable: classify(response.status) },
    );
  }

  const body = await response.json().catch(() => ({}));
  if (!body.userid) throw new NestAuthError('Nest-økten mangler bruker-id', { step: 'session' });

  return {
    userId: String(body.userid),
    // Nest oppgir sin egen utløpstid. Den er som regel en time, men vi stoler
    // på serveren framfor å regne selv.
    expiresAt: body.expires_in ? Date.parse(body.expires_in) : Date.now() + TOKEN_LIFETIME_MS,
    transportUrl: (body.urls && body.urls.transport_url) || null,
  };
}

// Hele kjeden. Returnerer alt et API-kall trenger, pluss den oppdaterte
// cookien som må lagres tilbake til innstillingene.
async function authenticate(issueToken, cookie, options = {}) {
  const token = await fetchAccessToken(issueToken, cookie, options);
  const { jwt } = await fetchJwt(token.accessToken, options);
  const session = await fetchSession(jwt, options);

  return {
    jwt,
    userId: session.userId,
    transportUrl: session.transportUrl,
    cookie: token.cookie,
    expiresAt: Math.min(token.expiresAt, session.expiresAt),
  };
}

// Når det er på tide å fornye. Egen funksjon fordi den testes uten nettverk.
function needsRenewal(expiresAt, now = Date.now(), marginMs = RENEW_MARGIN_MS) {
  if (!expiresAt) return true;
  return expiresAt - now <= marginMs;
}

module.exports = {
  NestAuthError,
  NEST_HOST,
  USER_AGENT,
  RENEW_MARGIN_MS,
  authenticate,
  fetchAccessToken,
  fetchJwt,
  fetchSession,
  mergeCookies,
  needsRenewal,
};
