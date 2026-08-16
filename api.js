'use strict';

// Broen innstillingssiden snakker gjennom. Siden har ingen tilgang til appens
// objekter direkte, bare til disse.

module.exports = {
  async getStatus({ homey }) {
    return homey.app.status();
  },

  async refresh({ homey }) {
    await homey.app.refreshNow();
    return { ok: true };
  },

  // Prøver verdiene før de lagres. Uten dette ville brukeren limt inn noe
  // nesten-riktig, lagret, og lurt på hvorfor det er stille — feilen dukker
  // ellers ikke opp før i appens logg.
  async testCredentials({ homey, body }) {
    return homey.app.testCredentials({
      issueToken: String((body && body.issueToken) || '').trim(),
      cookie: String((body && body.cookie) || '').trim(),
    });
  },
};
