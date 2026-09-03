# Goodtech Tønsberg Parking

A lightweight shared parking and meeting-room PWA for the Goodtech Tønsberg office.

## Current features

- Monday–Sunday schedule with strong **Today** highlighting.
- Goodtech-inspired navy/indigo visual theme using the supplied Goodtech logo.
- Parking status is colour-first: green = available, red = occupied.
- MG normal allocation is 2 spaces; after more than 2 are used, remaining free MG spaces turn yellow while bookings remain allowed.
- MG 69 is marked as an EV-charger space.
- Compact live schematic with MG 50–54 stacked, MG 69 separated, then F18 Øvreplan above F18 Nedreplan.
- Meeting-room booking from 06:00–18:00, minimum 1 hour and up to the full day.
- Weekly meeting-room availability bar with details on click.
- Searchable employee picker using `drivers.txt` and stable name-derived IDs.
- Duplicate same-day parking warnings without blocking deliberate duplicates.
- Shared monthly booking shards through MantleDB with optimistic updates and live polling.
- PWA install support, offline application shell, dark mode default and optional light mode.

## Shared state

`config.js` uses the anonymous MantleDB namespace `gt-parking-musab-20260903-v3`. Parking and meeting-room records share monthly entries under `bookings/YYYY-MM`. The GitHub Actions deployment test performs a real backend + CORS smoke check, and a scheduled workflow writes a keepalive every 14 days.

The public app intentionally has no login. Anyone with the URL can view and edit the board.

## Maintenance

- Employees: edit `drivers.txt`.
- Parking spaces / MG limit / charger metadata: edit `parking-config.json`.
- Meeting-room hours: edit the `meetingRoom` block in `parking-config.json` and matching constants in `booking-utils.js` if the operating window changes.

## Development

Serve the repository root over HTTP, for example:

```bash
python -m http.server 4173
```

Run unit tests:

```bash
npm test
```

Run the real shared-backend connectivity test (requires internet):

```bash
npm run test:backend
```
