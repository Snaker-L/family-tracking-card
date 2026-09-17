# Security

## Reporting a vulnerability

Please report it privately through
[GitHub's advisory form](https://github.com/Snaker-L/ha-family-tracking/security/advisories/new)
rather than opening an issue, so it can be fixed before it is public.

## What this integration touches

Worth knowing when judging a report:

- **Location data stays local.** Positions, stays and the merged tracker state
  never leave your Home Assistant.
- **Addresses do not.** With geocoding on, coordinates outside a zone are sent
  to [Nominatim](https://nominatim.openstreetmap.org) to be resolved, together
  with the contact address you configured, if any. Turn *Resolve addresses* off
  and nothing is sent anywhere.
- **Map tiles are fetched by the browser** from the provider chosen in the card,
  which sees the tile coordinates being viewed. The OpenStreetMap style sends
  your instance host as a referrer, because the provider blocks requests
  without one.
- **The card is served by Home Assistant itself**, from inside the integration,
  and is subject to its authentication like any other frontend resource.
