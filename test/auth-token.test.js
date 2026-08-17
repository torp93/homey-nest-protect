'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { fetchAccessToken } = require('../lib/nest-auth');

// Google har oppgitt levetid feil før. En negativ eller uleselig verdi ville
// gjort tokenet "utløpt" med en gang, og appen ville autentisert på nytt ved
// hvert eneste kall — en innloggingsløkke mot Google.

const ISSUE_TOKEN = 'https://accounts.google.com/o/oauth2/iframerpc'
  + '?action=issueToken&login_hint=x&client_id=y';
const COOKIE = '__Secure-3PSID=abc';

function stubFetch(body) {
  const original = global.fetch;
  global.fetch = async () => ({
    ok: true,
    status: 200,
    headers: { getSetCookie: () => [] },
    json: async () => body,
  });
  return () => { global.fetch = original; };
}

const HOUR = 3600 * 1000;

test('manglende expires_in gir én times levetid', async () => {
  const restore = stubFetch({ access_token: 't' });
  try {
    const { expiresAt } = await fetchAccessToken(ISSUE_TOKEN, COOKIE);
    assert.ok(expiresAt - Date.now() > HOUR - 5000);
  } finally { restore(); }
});

test('negativ, null og uleselig expires_in faller tilbake til én time', async () => {
  for (const value of [-1, 0, 'abc', null, undefined, NaN, {}]) {
    const restore = stubFetch({ access_token: 't', expires_in: value });
    try {
      const { expiresAt } = await fetchAccessToken(ISSUE_TOKEN, COOKIE);
      assert.ok(expiresAt - Date.now() > HOUR - 5000, `expires_in=${JSON.stringify(value)}`);
    } finally { restore(); }
  }
});

test('absurd stor expires_in klemmes til et døgn', async () => {
  const restore = stubFetch({ access_token: 't', expires_in: 99999999 });
  try {
    const { expiresAt } = await fetchAccessToken(ISSUE_TOKEN, COOKIE);
    assert.ok(expiresAt - Date.now() <= 24 * HOUR + 5000);
  } finally { restore(); }
});

test('en vanlig expires_in brukes som den er', async () => {
  const restore = stubFetch({ access_token: 't', expires_in: 1800 });
  try {
    const { expiresAt } = await fetchAccessToken(ISSUE_TOKEN, COOKIE);
    const left = expiresAt - Date.now();
    assert.ok(left > 1790 * 1000 && left <= 1800 * 1000);
  } finally { restore(); }
});
