'use strict';

// Innstillingene appen lever av. Begge må hentes manuelt fra en innlogget
// nettleser, så validering her er verdt bryet: en cookie limt inn med et
// avkuttet siste tegn gir ellers en kryptisk 400 fra Google en time senere.

const SETTING_ISSUE_TOKEN = 'issueToken';
const SETTING_COOKIE = 'cookie';

// Capabilities hver Protect får. Bevegelse kommer i tillegg, og bare på
// nettdrevne enheter — batteridrevne lar PIR-en sove, og capabilityen ville
// stått evig usann og sett ødelagt ut.
//
// Lista bor her fordi både driveren (ved paring) og enheten (ved oppgradering
// av eldre enheter) trenger den. Rekkefølgen er den samme som i manifestet.
const BASE_CAPABILITIES = [
  'alarm_smoke',
  'alarm_co',
  'alarm_heat',
  'alarm_battery',
  'alarm_tamper',
  'alarm_manual_test',
  'measure_voltage',
];

function capabilitiesFor(state) {
  return state.wired ? [...BASE_CAPABILITIES, 'alarm_motion'] : [...BASE_CAPABILITIES];
}

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

// Tegn som ikke kan stå i en HTTP-headerverdi. Alt annet slipper gjennom:
// semikolon, likhetstegn, mellomrom, punktum, understrek, bindestrek og
// prosentkoding er helt normal cookie-syntaks og skal ikke avvises.
//
// Verdt å avvise fremfor bare å strippe: et linjeskift midt i en cookie
// betyr som regel at innlimingen er avkortet, og da er det bedre å si fra enn
// å koble til med en halv nøkkel.
// eslint-disable-next-line no-control-regex
const ILLEGAL_HEADER_CHARS = /[\u0000-\u001F\u007F]/;

function hasIllegalHeaderChars(value) {
  return ILLEGAL_HEADER_CHARS.test(String(value || ''));
}

// Hva som mangler, formulert slik at det kan vises rett til brukeren.
function validate({ issueToken, cookie }) {
  const problems = [];
  if (!String(issueToken || '').trim()) problems.push('missingIssueToken');
  else if (!isValidIssueToken(issueToken)) problems.push('badIssueToken');

  if (!String(cookie || '').trim()) problems.push('missingCookie');
  // Rekkefølgen er med vilje: en cookie med linjeskift i seg er som regel en
  // avkortet innliming, og den beskjeden er mer treffende enn «mangler
  // øktnøkkelen».
  else if (hasIllegalHeaderChars(String(cookie).trim())) problems.push('brokenCookie');
  else if (!isValidCookie(cookie)) problems.push('badCookie');

  return problems;
}

// Kontrolltegn fjernes før verdiene brukes. En cookie kopiert fra DevTools får
// lett med seg et linjeskift, og et linjeskift i en HTTP-header er ikke bare
// ugyldig — feilmeldingen fra fetch siterer hele verdien tilbake, altså hele
// Google-øktnøkkelen, rett inn i logg og innstillingsside.
function clean(value) {
  // eslint-disable-next-line no-control-regex
  return String(value || '').replace(/[\u0000-\u001F\u007F]/g, '').trim();
}

function readSettings(settings) {
  return {
    issueToken: clean(settings.get(SETTING_ISSUE_TOKEN)),
    cookie: clean(settings.get(SETTING_COOKIE)),
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
  BASE_CAPABILITIES,
  capabilitiesFor,
  REQUIRED_COOKIE,
  BACKOFF_START_MS,
  BACKOFF_MAX_MS,
  clean,
  hasIllegalHeaderChars,
  isValidIssueToken,
  isValidCookie,
  validate,
  readSettings,
  backoffMs,
};
