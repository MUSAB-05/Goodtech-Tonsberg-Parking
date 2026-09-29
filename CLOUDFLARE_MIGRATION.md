# GT Parking storage migration

The public site stays at `https://musab-05.github.io/Goodtech-Tonsberg-Parking/`. Cloudflare only provides the API and database behind it.

## Setup

The D1 database `gt-parking` was created with ID `6f1a86af-e7d1-4510-90f5-29443b5484a7`. A manual GitHub Actions workflow on `main` deploys the API from this branch; it does not change the live website.

1. In Cloudflare, find the **account ID** (distinct from the D1 database ID). Create an account-scoped API token with **Edit Cloudflare Workers** and **D1 Edit** permissions.
2. In the GitHub repository, under **Settings → Secrets and variables → Actions**, add the repository secret `CLOUDFLARE_API_TOKEN`. Never paste the token into a chat or commit it.
3. Under **Actions → Deploy parking storage API**, choose **Run workflow** on `main` and paste the non-secret account ID into its input. It tests the Worker, applies `cloudflare/schema.sql`, deploys `gt-parking-api`, and sets `ACCESS_CODE_HASH` from the existing public access gate. Save the resulting `workers.dev` URL from the run output. The website URL remains GitHub Pages.
4. Keep the live `config.js` on Mantle. Verify the deployed API before migrating records.

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
