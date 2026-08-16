'use strict';

// Nest lagrer romnavn for seg selv, i en `where`-bøtte per husstand. En Protect
// peker på et rom med `where_id` og har i tillegg et valgfritt eget navn i
// `description`.
//
// Tre av sju enheter har ingen `description` i det hele tatt: den står tom når
// rommet er valgt fra Nests egen liste i stedet for skrevet inn for hånd. Uten
// oppslaget her ville de blitt hetende serienummeret sitt.
//
// De innebygde rommene har engelske navn («Hallway», «Master Bedroom») også på
// en norsk konto, mens rom brukeren selv har laget er på norsk. Vi lar dem stå
// som de er — det er navnene som møter deg i Nest-appen, og et halvoversatt
// hus er verre enn et konsekvent engelsk-norsk et.

// Bygger oppslaget fra bøttene app_launch ga oss.
function buildWhereMap(buckets = []) {
  const map = new Map();

  for (const bucket of buckets) {
    if (!String(bucket.object_key || '').startsWith('where.')) continue;
    for (const where of (bucket.value && bucket.value.wheres) || []) {
      if (where && where.where_id && where.name) map.set(where.where_id, where.name);
    }
  }

  return map;
}

// Navnet enheten skal få. Rommet først, det egne navnet i parentes: rommet er
// det brukeren finner igjen i Nest-appen, og «Hallway (Utenfor Kontor)» skiller
// to varslere som begge står i «Hallway».
function deviceLabel(state, whereMap, whereId) {
  const room = whereMap && whereId ? whereMap.get(whereId) : null;
  const own = state && state.name ? String(state.name).trim() : null;

  if (room && own && room !== own) return `${room} (${own})`;
  if (own) return own;
  if (room) return room;
  // Serienummeret er stygt, men det er entydig, og en enhet uten navn i det
  // hele tatt er verre å finne igjen.
  return (state && state.id) || 'Nest Protect';
}

// `where_id` ligger i den rå bøtta, ikke i den normaliserte tilstanden:
// topaz.js holder på det som beskriver varsleren, ikke på husstandens
// romstruktur.
function whereIdOf(bucket) {
  return (bucket && bucket.value && bucket.value.where_id) || null;
}

module.exports = { buildWhereMap, deviceLabel, whereIdOf };
