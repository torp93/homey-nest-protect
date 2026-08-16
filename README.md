# Nest Protect for Homey

Real-time smoke, CO and heat alarms from Nest Protect on Homey Pro.

> **Safety notice.** Nest Protect sounds locally and interconnects with its
> siblings regardless of this app. Treat Homey as notification and automation
> on top of that, never as part of the safety chain.

## Why this exists

Google's Smart Device Management API — the supported, documented way to reach
Nest devices — **does not cover Nest Protect at all.** It exposes thermostats,
cameras, doorbells and displays. Smoke alarms have never been included.

The only route left is the legacy Nest API that the Nest app itself uses. This
app takes that route, and does one thing with it: Protect, properly.

The key difference from polling-based integrations is `subscribe`. Nest holds
the connection open and answers the moment something changes, so an alarm
reaches Homey in the same second the unit starts sounding — not at the next
poll interval.

## Status

Early. The protocol layer is implemented and verified against real hardware;
the Homey driver is still being built.

| Component | State |
| --- | --- |
| `lib/nest-auth.js` — cookie → token → JWT → session | verified against Google and Nest |
| `lib/nest-client.js` — `app_launch` + `subscribe` | verified, 7 devices |
| `lib/topaz.js` — device state → capabilities | 16 unit tests |
| `lib/where.js` — room name resolution | 6 unit tests |
| Driver, settings page, flow cards | not yet |

## Capabilities

| Capability | Source |
| --- | --- |
| `alarm_smoke` | `smoke_status` at emergency level |
| `alarm_co` | `co_status` at emergency level |
| `alarm_heat` | `heat_status` at emergency level |
| `alarm_battery` | Nest's own `battery_health_state` |
| `alarm_tamper` | `removed_from_base` |
| `measure_voltage` | `battery_level`, in volts |
| `alarm_motion` | mains-powered units only |

Nest reports three levels per hazard: clear, heads-up, and emergency. Only
emergency raises the alarm capability. Heads-up is surfaced separately, so a
flow that unlocks a door on fire does not fire on a wisp of steam.

Battery is reported as **voltage, not percentage.** Nest gives millivolts
without stating what empty means, and an invented percentage scale would look
more precise than it is. `alarm_battery` carries Nest's own verdict on when it
matters.

Motion is only exposed on mains-powered units. Battery-powered Protects let the
PIR sleep, so the field says nothing about the room. Note that even where it is
exposed, the underlying signal is occupancy with a ten-minute decision window —
it is not a motion sensor.

## Authentication

Google removed API-key access, so the only way in is a session cookie plus the
`issueToken` URL, both extracted manually from a signed-in browser session.

**The cookie is a full Google account session credential, not a Nest-scoped
token.** Anyone holding it holds the account. Keep it out of screenshots,
version control and bug reports. It stops working if you sign out of that
browser session or change your password.

The app writes rotated cookies back to its settings automatically — Google
rotates them on every sign-in, and a client that keeps sending the original
gets logged out within a few cycles.

## Development

```bash
npm test
```

Tests run against real device payloads captured from live hardware, with
identifiers anonymised. No network access required.

## Credits

Protocol research from [iMicknl/ha-nest-protect](https://github.com/iMicknl/ha-nest-protect)
(MIT), which builds on [chrisjshull/homebridge-nest](https://github.com/chrisjshull/homebridge-nest).
This is an independent JavaScript implementation for Homey.

Unofficial and undocumented. Not affiliated with Google or Nest. The endpoints
can change or disappear without warning.

## License

MIT — see [LICENSE](LICENSE).
