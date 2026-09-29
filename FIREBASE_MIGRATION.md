# Parking storage migration

The public website stays at `https://musab-05.github.io/Goodtech-Tonsberg-Parking/`.
The live site currently uses Mantle. Do not switch `storageProvider` until all Mantle records are copied and verified.

## Create the no-cost Firebase project

1. Create a Firebase project on the **Spark** plan and add a web app. Copy its `apiKey`.
2. Create **Realtime Database** and copy its exact database URL. Enable **Anonymous** under Authentication → Sign-in method.
3. Set the Realtime Database rules to:

```json
{
  "rules": {
    ".read": "auth != null",
    ".write": "auth != null"
  }
}
```

Anonymous authentication is comparable to the existing publicly shipped Mantle key: it does not verify an employee's identity. The existing front-end access code is not server-side authorization. Stronger user accounts and restrictive rules should be added if this site stores private employee data.

## Copy and verify all data

Run the following from a checkout of this branch after Mantle responds normally. Do not commit the `backups/` directory.

```bash
FIREBASE_API_KEY='web-app-api-key' FIREBASE_DATABASE_URL='https://your-database-url' node scripts/migrate-mantle-to-firebase.mjs
```

The script reads Mantle's authenticated list, downloads every listed path, saves a local JSON backup, copies missing paths into Firebase, and reads them back for verification. It refuses to overwrite different Firebase data. It never deletes Mantle data.

## Cut over

After the script reports successful verification, put the Firebase web app API key and database URL into `config.js`, then change `storageProvider` to `firebase`. Deploy the branch to `main`, bump the cache name in `sw.js`, and check historical bookings, today's parking, meeting room, votes, green deeds and frequency history in the live page. Keep the Mantle data untouched until those checks pass.

Avoid accepting new bookings during the copy and cutover. Otherwise changes made after the backup could be missing from Firebase; rerun after addressing any destination differences.
