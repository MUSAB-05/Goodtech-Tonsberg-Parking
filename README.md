# Goodtech Tønsberg Parking

Lightweight shared parking-allocation PWA for the Goodtech Tønsberg office.

## Live app

GitHub Pages production URL after the Pages workflow provisions the site:

`https://musab-05.github.io/Goodtech-Tonsberg-Parking/`

The public website intentionally has no user accounts or passwords. Anyone with the URL can view and change parking assignments.

## Configuration

- `drivers.txt` — one employee per line; `#` starts a comment.
- `parking-config.json` — parking groups, spaces and normal allocation limits.
- `config.js` — app settings plus the MantleDB namespace used for shared state.

Stable employee IDs are generated from normalized names, so reordering `drivers.txt` does not break bookings.

## Shared data

Bookings are stored in an unclaimed MantleDB namespace, matching this app's intentionally open shared-board model. Data is sharded monthly at paths such as `bookings/2026-09`, with fields keyed like `2026-09-03__mg-50`.

The app polls the month(s) needed for the visible week roughly once per second while the page is visible. A scheduled GitHub Action writes a small keepalive entry every 14 days so the free anonymous namespace does not expire from inactivity.

## Local development

Serve the repository over HTTP with `python -m http.server 4173`, then open `http://localhost:4173/`.

Run validation with `npm test` plus `node --check` on the JavaScript modules.

## Deployment

`.github/workflows/pages.yml` runs tests and deploys the repository root to GitHub Pages from `main`.

## Parking rules

MG Basement has six physical spaces (50, 51, 52, 53, 54, 69) but a normal allocation of two. More than two MG bookings are allowed and shown with warnings rather than blocked. Duplicate same-day employee bookings are also allowed but highlighted with the other parking space named in the warning.
