'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { NestClient } = require('../lib/nest-client');

// Et svar med status 200 og en kropp vi ikke kan lese må ikke bli til
// «ingenting endret seg». Gjør det det, melder appen seg frisk mens den viser
// gamle faredata — en feilside fra en proxy ville sett ut som et rolig hus.

const COOKIE = '__Secure-3PSID=hemmelig-verdi-som-ikke-skal-lekke; NID=511=abc';

function clientWithSession() {
  const client = new NestClient({ issueToken: 'https://example.invalid', cookie: COOKIE });
  // Hopper over innloggingen: vi tester svarhåndteringen, ikke auth.
  client._session = {
    jwt: 'jwt-som-ikke-skal-lekke',
    userId: '1',
    transportUrl: 'https://transport.invalid',
    expiresAt: Date.now() + 3600 * 1000,
  };
  return client;
}

function stubFetch(response) {
  const original = global.fetch;
  global.fetch = async () => response;
  return () => { global.fetch = original; };
}

function jsonResponse(body, { ok = true, status = 200 } = {}) {
  return {
    ok,
    status,
    json: async () => {
      if (typeof body === 'function') return body();
      return body;
    },
  };
}

test('ugyldig JSON med status 200 blir en feil, ikke «ingen endringer»', async () => {
  const restore = stubFetch(jsonResponse(() => {
    throw new SyntaxError('Unexpected token < in JSON at position 0');
  }));

  try {
    await assert.rejects(
      () => clientWithSession().subscribe([]),
      (error) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /unreadable/i);
        return true;
      },
    );
  } finally {
    restore();
  }
});

test('en HTML-feilside blir en feil, og kroppen lekker ikke ut i meldingen', async () => {
  const html = '<html><body>502 Bad Gateway — upstream said __Secure-3PSID=leaked</body></html>';
  const restore = stubFetch(jsonResponse(() => { throw new SyntaxError(`Unexpected token < ... ${html}`); }));

  try {
    await clientWithSession().subscribe([]);
    assert.fail('skulle ha kastet');
  } catch (error) {
    assert.ok(!error.message.includes('__Secure-3PSID'), 'ingen cookie i feilmeldingen');
    assert.ok(!error.message.includes('502 Bad Gateway'), 'ingen svarkropp i feilmeldingen');
    assert.ok(!error.message.includes('jwt-som-ikke-skal-lekke'), 'ingen JWT i feilmeldingen');
  } finally {
    restore();
  }
});

test('et svar som ikke er et objekt blir en feil', async () => {
  for (const body of [null, 'ok', 42]) {
    const restore = stubFetch(jsonResponse(body));
    try {
      await assert.rejects(() => clientWithSession().subscribe([]), /unexpected response/i);
    } finally {
      restore();
    }
  }
});

test('gyldig svar uten endringer gir tom liste og ingen feil', async () => {
  const restore = stubFetch(jsonResponse({ objects: [] }));
  try {
    const result = await clientWithSession().subscribe([]);
    assert.deepStrictEqual(result.buckets, []);
    assert.strictEqual(result.reauthenticated, false);
  } finally {
    restore();
  }
});

test('gyldig svar med endringer leverer bøttene', async () => {
  const bucket = { object_key: 'topaz.A', object_revision: 2, object_timestamp: 3, value: {} };
  const restore = stubFetch(jsonResponse({ objects: [bucket] }));
  try {
    const result = await clientWithSession().subscribe([]);
    assert.strictEqual(result.buckets.length, 1);
    assert.strictEqual(result.buckets[0].object_key, 'topaz.A');
  } finally {
    restore();
  }
});

test('objects som ikke er en liste behandles som ingen endringer', async () => {
  const restore = stubFetch(jsonResponse({ objects: 'nope' }));
  try {
    const result = await clientWithSession().subscribe([]);
    assert.deepStrictEqual(result.buckets, []);
  } finally {
    restore();
  }
});

test('401 under lytting ber om ny innlogging i stedet for å feile', async () => {
  const restore = stubFetch(jsonResponse({}, { ok: false, status: 401 }));
  try {
    const result = await clientWithSession().subscribe([]);
    assert.strictEqual(result.reauthenticated, true);
    assert.deepStrictEqual(result.buckets, []);
  } finally {
    restore();
  }
});

test('en HTTP-feil nevner status, men ikke legitimasjon', async () => {
  const restore = stubFetch(jsonResponse({}, { ok: false, status: 502 }));
  try {
    await clientWithSession().subscribe([]);
    assert.fail('skulle ha kastet');
  } catch (error) {
    assert.match(error.message, /502/);
    assert.ok(!error.message.includes('__Secure-3PSID'));
    assert.ok(!error.message.includes('jwt-som-ikke-skal-lekke'));
  } finally {
    restore();
  }
});
