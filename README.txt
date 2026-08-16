Smoke, CO and heat alarms from Nest Protect, the moment they happen.

Google's supported API does not cover Nest Protect at all — it reaches
thermostats, cameras and doorbells, but never smoke alarms. This app takes the
route the Nest app itself uses, and does one thing with it.

The app holds an open connection to Nest, so an alarm reaches Homey the second
it sounds rather than at the next poll.

Each alarm reports smoke, carbon monoxide and heat, battery warning and
voltage, whether it has been removed from its base, and a manual test you can
use to confirm the whole chain works without a real fire. Mains-powered units
also report occupancy. Model, serial, replacement date and the five self-test
results are in the device settings.

Flow cards cover early hazard warnings, the connection to Nest going down or
coming back, and a condition for whether Nest is reachable. Smoke alarms are
silent for months at a time, so a broken connection looks exactly like a quiet
house — the connection card exists to tell you the difference.

SETTING IT UP

Google removed API-key access, so signing in needs two values copied by hand
from a signed-in browser session. The app settings explain where to find them.

That cookie is a session credential for your whole Google account, not a
Nest-only token. Keep it out of screenshots and bug reports.

BEFORE YOU RELY ON IT

Nest Protect sounds locally and interconnects with its siblings regardless of
this app. Treat Homey as notification and automation on top of that, never as
part of the safety chain.

Unofficial and undocumented. Not affiliated with Google or Nest. Protocol
research builds on ha-nest-protect and homebridge-nest.
