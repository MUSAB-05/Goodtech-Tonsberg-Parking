# GT Parking storage migration

The public site stays at `https://musab-05.github.io/Goodtech-Tonsberg-Parking/`. Cloudflare only provides the API and database behind it.

## Setup

1. Create a free Cloudflare account. Create a D1 database named `gt-parking`.
2. Copy `cloudflare/wrangler.toml.example` to `cloudflare/wrangler.toml` and enter the D1 database ID. Keep that local config out of Git until ready.
3. Apply `cloudflare/schema.sql` to the D1 database. Deploy `cloudflare/src/worker.js` with Wrangler.
4. Set the Worker secret `ACCESS_CODE_HASH` to the SHA-256 hash of the existing employee access code. The current hash is in `access-gate.js`; keep the actual code out of the repository.
5. The Worker should be available at a `workers.dev` API URL. The website URL remains GitHub Pages.

## Preserve and copy the records

After Mantle allows reads again, run from a checkout of this branch:

```bash
PARKING_API_URL='https://your-worker.workers.dev' PARKING_ACCESS_CODE='your-employee-code' node scripts/migrate-mantle-to-d1.mjs
```

The script reads the authenticated Mantle listing, downloads **all** listed paths, saves a local JSON backup, copies missing records to D1, and reads every record back. It refuses to overwrite different destination data. It never deletes Mantle data. `backups/` is ignored by Git.

Keep bookings paused during the copy and switch so that a write does not land in Mantle after the snapshot. If the script fails, the live site continues to use Mantle.

## Cut over

After the copy verifies, set `storageProvider: 'd1'` and the Worker's `apiUrl` in `config.js`, publish to `main`, and bump the service-worker cache name. Check bookings, past history, meeting room, votes, green deeds, and frequency data on the live page. Keep the original Mantle namespace untouched until these checks pass.

The free Cloudflare Worker has 100,000 requests per day, resetting at midnight UTC; D1 includes 5 million rows read and 100,000 rows written per day. At one refresh every ten minutes, 100 tabs open continuously during a month-boundary week would make about 43,200 API calls per day (two booking months and one event read per refresh), plus initial loads and user actions. Ordinary office-hour usage is far lower. These are usage limits, not a fixed maximum number of users.
