---
description: Pre-flight a strategy before deploying (imports, data, broker, license)
---

First check the engine's /ui/api/capabilities: if no active execution broker is configured, tell me and point me to Settings -> Extensions -> Auracle to connect one before continuing. Then list the available strategies and ask which one to check. Run pre-flight validation (code imports, universe data availability, broker auth, license tier) and show a pass / warn / fail verdict for each check.
