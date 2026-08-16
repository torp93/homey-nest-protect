Smoke, CO and heat alarms from Nest Protect, the moment they happen.

Google's supported Smart Device Management API does not cover Nest Protect at
all — it reaches thermostats, cameras, doorbells and displays, but smoke alarms
have never been included. This app takes the route the Nest app itself uses, and
does one thing with it: Nest Protect, properly.

Alarms arrive in real time. The app holds an open connection to Nest and is told
the instant something changes, rather than asking every few minutes and finding
out late.

WHAT YOU GET

Per alarm:
- Smoke, carbon monoxide and heat alarms
- Manual test, so you can confirm the whole chain works without a real fire
- Removed from base
- Battery warning, using Nest's own assessment
- Battery voltage, which you can trend in Insights
- Occupancy, on mains-powered units only
- Model, serial, software, replacement date and the last manual test
- The five self-test results the Nest app shows: sensors, alarm, voice,
  battery and Wi-Fi

Flow cards:
- A hazard warning started — Nest reports a rising level before it sounds a
  full alarm, and this fires on that early warning rather than the alarm
- Connection to Nest changed — smoke alarms are silent for months, so a broken
  connection looks exactly like a quiet house
- Fetch everything from Nest now
- Nest is connected — as a condition

Only a full alarm raises the smoke, CO and heat capabilities. Nest reports three
levels, and a flow that unlocks a door when the house is on fire should not fire
on steam from a shower.

Battery is reported as voltage rather than a percentage. Nest gives millivolts
without saying what empty means, and an invented percentage scale would look
more precise than it is.

SETTING IT UP

Google removed API-key access, so signing in requires two values copied by hand
from a signed-in browser session: an issue token URL and a cookie. The app
settings explain where to find them, step by step.

Be aware of what that cookie is. It is a session credential for your whole
Google account, not a Nest-only token. Keep it out of screenshots and bug
reports. It stops working if you sign out of that browser session or change
your password, and you will then need to fetch the values again.

BEFORE YOU RELY ON IT

Nest Protect sounds locally and interconnects with its siblings regardless of
this app. Treat Homey as notification and automation on top of that, never as
part of the safety chain itself.

This app uses an undocumented interface that Google can change or withdraw
without warning. It is not affiliated with Google or Nest.

Protocol research builds on the open-source projects ha-nest-protect and
homebridge-nest. This is an independent implementation for Homey.
