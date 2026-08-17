'use strict';

const test = require('node:test');
const assert = require('node:assert');

const {
  clean, validate, hasIllegalHeaderChars, isValidCookie,
} = require('../lib/protect-config');
const { fetchAccessToken, fetchJwt, fetchSession } = require('../lib/nest-auth');

// Kanarifuglen. Dukker denne strengen opp i en feilmelding, har hele
// Google-øktnøkkelen lekket ut i logg, innstillingsside eller paringsdialog.
const CANARY = 'HEMMELIG_KANARIFUGL_12345';
const SECRET_COOKIE = `__Secure-3PSID=${CANARY}`;

const LF = String.fromCharCode(10);
const CR = String.fromCharCode(13);
const NUL = String.fromCharCode(0);
const DEL = String.fromCharCode(127);

const ISSUE_TOKEN = 'https://accounts.google.com/o/oauth2/iframerpc'
  + '?action=issueToken&login_hint=x&client_id=y';

// ---- inndata ----

test('clean fjerner kontrolltegn, men lar cookie-syntaks stå', () => {
  const dirty = `${SECRET_COOKIE}${CR}${LF}; NID=511=a.b-c_d%20e; __Host-3PLSID=s.NO|s.youtube:x${NUL}${DEL}`;
  const cleaned = clean(dirty);

  assert.ok(!hasIllegalHeaderChars(cleaned), 'ingen kontrolltegn igjen');
  // Alt som er lovlig cookie-syntaks må overleve.
  for (const fragment of [';', '=', ' ', '.', '-', '_', '%20', '|', ':']) {
    assert.ok(cleaned.includes(fragment), `beholder ${JSON.stringify(fragment)}`);
  }
  assert.ok(isValidCookie(cleaned), 'øktnøkkelen er intakt');
});

test('validate avviser cookie med linjeskift med en egen beskjed', () => {
  assert.deepStrictEqual(
    validate({ issueToken: ISSUE_TOKEN, cookie: `${SECRET_COOKIE}${LF}X: y` }),
    ['brokenCookie'],
  );
  assert.deepStrictEqual(
    validate({ issueToken: ISSUE_TOKEN, cookie: `${SECRET_COOKIE}${NUL}` }),
    ['brokenCookie'],
  );
});

test('validate godtar en helt vanlig Nest-cookie', () => {
  const real = '__Secure-3PSID=abc.; __Secure-3PAPISID=x/y-z; NID=511=A_b-c%2Fd; '
    + '__Host-3PLSID=s.NO|s.youtube:Qw.; __Secure-3PSIDCC=AIK-x_y';
  assert.deepStrictEqual(validate({ issueToken: ISSUE_TOKEN, cookie: real }), []);
});

// ---- feilmeldinger ----

function stubFetch(thrower) {
  const original = global.fetch;
  global.fetch = async (...args) => thrower(...args);
  return () => { global.fetch = original; };
}

// Slik undici faktisk feiler på en ugyldig headerverdi: hele verdien siteres
// ordrett i meldingen.
function headerTypeError(value) {
  const error = new TypeError(`Headers.append: "${value}" is an invalid header value.`);
  return error;
}

test('cookien lekker ikke ut når Google-kallet feiler', async () => {
  const restore = stubFetch(() => { throw headerTypeError(`${SECRET_COOKIE}${LF}X: y`); });
  try {
    await fetchAccessToken(ISSUE_TOKEN, SECRET_COOKIE);
    assert.fail('skulle ha kastet');
  } catch (error) {
    assert.ok(!error.message.includes(CANARY), 'ingen cookie i meldingen');
    assert.ok(!String(error.stack).includes(CANARY), 'ingen cookie i stacken');
    assert.match(error.message, /Could not reach Google/);
  } finally {
    restore();
  }
});

test('access tokenet lekker ikke ut når JWT-kallet feiler', async () => {
  const token = `ya29.${CANARY}`;
  const restore = stubFetch(() => { throw headerTypeError(`Bearer ${token}`); });
  try {
    await fetchJwt(token);
    assert.fail('skulle ha kastet');
  } catch (error) {
    assert.ok(!error.message.includes(CANARY), 'ingen access token i meldingen');
    assert.ok(!String(error.stack).includes(CANARY), 'ingen access token i stacken');
  } finally {
    restore();
  }
});

test('JWT-et lekker ikke ut når øktkallet feiler', async () => {
  const jwt = `g.0.${CANARY}`;
  const restore = stubFetch(() => { throw headerTypeError(`Basic ${jwt}`); });
  try {
    await fetchSession(jwt);
    assert.fail('skulle ha kastet');
  } catch (error) {
    assert.ok(!error.message.includes(CANARY), 'ingen JWT i meldingen');
    assert.ok(!String(error.stack).includes(CANARY), 'ingen JWT i stacken');
  } finally {
    restore();
  }
});

test('feilmeldingen beholder årsakskoden, som er det man feilsøker på', async () => {
  const dns = new Error('getaddrinfo ENOTFOUND accounts.google.com');
  dns.code = 'ENOTFOUND';
  const restore = stubFetch(() => { throw dns; });
  try {
    await fetchAccessToken(ISSUE_TOKEN, SECRET_COOKIE);
    assert.fail('skulle ha kastet');
  } catch (error) {
    assert.match(error.message, /ENOTFOUND/);
  } finally {
    restore();
  }
});

test('årsak hentes også fra error.cause', async () => {
  const wrapped = new TypeError('fetch failed');
  wrapped.cause = Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' });
  const restore = stubFetch(() => { throw wrapped; });
  try {
    await fetchAccessToken(ISSUE_TOKEN, SECRET_COOKIE);
    assert.fail('skulle ha kastet');
  } catch (error) {
    assert.match(error.message, /ECONNRESET/);
  } finally {
    restore();
  }
});
