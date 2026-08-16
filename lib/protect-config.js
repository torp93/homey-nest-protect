'use strict';

// Innstillingene appen lever av. Begge må hentes manuelt fra en innlogget
// nettleser, så validering her er verdt bryet: en cookie limt inn med et
// avkuttet siste tegn gir ellers en kryptisk 400 fra Google en time senere.

const SETTING_ISSUE_TOKEN = 'issueToken';
const SETTING_COOKIE = 'cookie';

// Cookien er verdiløs uten øktnøkkelen. De andre verdiene varierer med hvordan
// brukeren er logget inn, men uten denne er det ingen vits i å prøve.
const REQUIRED_COOKIE = '__Secure-3PSID';

function isValidIssueToken(value) {
  const text = String(value || '').trim();
  if (!text.startsWith('https://accounts.google.com/o/oauth2/iframerpc')) return false;
  // Uten login_hint vet ikke Google hvilken konto det gjelder, og svarer med
  // et token for feil bruker eller ingen i det hele tatt.
  return text.includes('login_hint=') && text.includes('client_id=');
}

function isValidCookie(value) {
  return String(value || '').includes(`${REQUIRED_COOKIE}=`);
}

// Hva som mangler, formulert slik at det kan vises rett til brukeren.
function validate({ issueToken, cookie }) {
  const problems = [];
  if (!String(issueToken || '').trim()) problems.push('missingIssueToken');
  else if (!isValidIssueToken(issueToken)) problems.push('badIssueToken');

  if (!String(cookie || '').trim()) problems.push('missingCookie');
  else if (!isValidCookie(cookie)) problems.push('badCookie');

  return problems;
}

function readSettings(settings) {
  return {
    issueToken: String(settings.get(SETTING_ISSUE_TOKEN) || '').trim(),
    cookie: String(settings.get(SETTING_COOKIE) || '').trim(),
  };
}

// Eksponentiell backoff for gjenoppkobling. Starter kjapt, fordi de fleste
// bruddene er øyeblikkelige nettverkshikk, og gir seg på fem minutter så en
// nede-periode hos Google ikke blir til et hamrende gjenforsøk.
const BACKOFF_START_MS = 5000;
const BACKOFF_MAX_MS = 5 * 60 * 1000;

function backoffMs(attempt) {
  return Math.min(BACKOFF_START_MS * (2 ** Math.max(0, attempt - 1)), BACKOFF_MAX_MS);
}

module.exports = {
  SETTING_ISSUE_TOKEN,
  SETTING_COOKIE,
  REQUIRED_COOKIE,
  BACKOFF_START_MS,
  BACKOFF_MAX_MS,
  isValidIssueToken,
  isValidCookie,
  validate,
  readSettings,
  backoffMs,
};
