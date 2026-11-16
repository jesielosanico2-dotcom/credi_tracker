# Credit Tracker

A local credit-management system for a sari-sari store. The local version uses Node.js and XAMPP MySQL. An optional Cloudflare Worker version uses D1 and keeps its hosted data separate.

## Deploy the full system to Cloudflare Workers

The login page alone is not the full app: `/api/...` needs the Worker, and the Worker needs its D1 database. This project contains a Worker entry point, static-asset routing, a D1 schema migration, and a Cloudflare D1 storage/authentication adapter. Your XAMPP database remains local and is not automatically connected to D1.

1. In a terminal at the project folder, install dependencies and sign in:

   ```powershell
   npm install
   npx wrangler login
   ```

2. Create the D1 database:

   ```powershell
   npm run cf:d1:create
   ```

   Wrangler prints a database ID. Copy it into `wrangler.jsonc`, replacing `REPLACE_WITH_D1_DATABASE_ID`.
3. Create the D1 tables:

   ```powershell
   npm run cf:d1:migrate
   ```

4. Set a private one-time owner setup key. Wrangler will prompt for its value:

   ```powershell
   npx wrangler secret put OWNER_SETUP_KEY
   ```

   Do not paste the secret into chat or commit it to a file.
5. The Wrangler Worker name is set to `credi-tracker` to match the existing `credi-tracker.jesielosanico2.workers.dev` URL. Deploy the Worker and `public` assets:

   ```powershell
   npm run cf:deploy
   ```

   Open the `*.workers.dev` address Wrangler reports. On first launch, enter the setup key and create the owner account.
   To reset the hosted owner password later, run `npm run owner:reset-password:cloud` from the project folder. Wrangler must be logged in; the new password is entered through a hidden terminal prompt, and existing sessions are signed out.
6. To copy current XAMPP records, first export them:

   ```powershell
   npm run db:export-json
   npm run db:import-d1
   ```

   The D1 import **replaces the hosted store records** (settings, customers, applications, and transactions). Back up first if the hosted database already has records. Owner accounts and sessions are not copied; create the hosted owner account in the app.

For a local Worker preview, apply the migration to the local D1 database and provide a throwaway setup key:

```powershell
npm run cf:d1:migrate:local
npm run cf:dev -- --var OWNER_SETUP_KEY:local-only-test-key
```

## Run locally with XAMPP

1. Start **MySQL** in the XAMPP Control Panel.
2. In phpMyAdmin, import `credit_tracker.sql`.
3. Copy `.env.example` to `.env` and adjust MySQL settings if needed. The default is `127.0.0.1:3306`, user `root`, blank password.
4. Run:

   ```powershell
   npm start
   ```

5. Open `http://localhost:3000`.

For development with automatic restart, use `npm run dev`. If the app is already running, it detects it and exits rather than starting a duplicate server.

## Features

- Dashboard with outstanding credit, payments collected this month, overdue balances, pending applications, recent activity, and largest balances.
- Searchable customer records and account histories.
- Owner-only customer deletion, including the customer's transaction and application history; deletion is permanent.
- New-customer and credit-limit applications that require owner review.
- Credit-limit checks, account suspension/reactivation, credits, payments, and audited transaction voids.
- Overdue account list, overdue-day counts, and copyable reminder messages.
- Owner setup, sign-in, sign-out, password hashing, secure session cookies, and setup-key protection for Cloudflare.
- JSON export/import for data transfer and backup.

## Project layout

```text
api/index.js            Vercel API adapter (not the Cloudflare entry point)
src/server.js           Shared Node HTTP API and local Node server
src/worker.mjs          Cloudflare Worker entry point
src/d1-auth.js          D1 owner authentication and sessions
src/d1-store.js         D1 optimistic-concurrency store
src/mysql-database.js   Local XAMPP MySQL connection
src/mysql-store.js      Local MySQL persistence
migrations/d1/          Cloudflare D1 schema migrations
public/                 Frontend HTML, CSS, JavaScript, and images
scripts/json-to-d1.js   Import local JSON backup into remote D1
wrangler.jsonc           Cloudflare Worker, D1, and asset configuration
credit_tracker.sql      Local XAMPP MySQL schema and sample data
package.json             Scripts and dependencies
```

## Tests and security

Run tests with `npm test`. The local server listens on `127.0.0.1`; it is not intended to be exposed directly to the internet. Keep database passwords and deployment secrets private. Cloudflare Worker secrets should be set with `wrangler secret put`.