# Credit Tracker

A local credit-management system for a sari-sari store, based on the supplied UI prototype. The backend uses Node.js and MySQL, the database included with XAMPP. The responsive frontend uses plain HTML, CSS, and JavaScript.

## Set up XAMPP and MySQL

1. Install [Node.js 20 or newer](https://nodejs.org/) and XAMPP.
2. Open the XAMPP Control Panel and start **MySQL**.
3. In phpMyAdmin, open the **Import** tab, choose `credit_tracker.sql`, and click **Import**. Alternatively, open the **SQL** tab and paste the contents of that file. It creates the `credit_tracker` database, tables, and sample records. Do not paste `data.json` into the SQL tab; JSON is not SQL.
4. Copy `.env.example` to `.env`. The defaults use the usual XAMPP MySQL settings (`127.0.0.1:3306`, user `root`, blank password). If you set a MySQL root password or changed the port, update `DB_PASSWORD` or `DB_PORT` in `.env`.
5. From this project folder, run `npm install`, then `npm start`.
6. Open [http://localhost/utang_managementsystem](http://localhost/utang_managementsystem) to use the XAMPP folder shortcut, or open [http://127.0.0.1:3000](http://127.0.0.1:3000) directly. On first launch, create the owner account with a username and a password of at least 12 characters.

XAMPP serves `index.php` from `htdocs/utang_managementsystem` as a shortcut to the Node.js app. Start the Node.js app with `npm run dev` before opening that shortcut; if Node is not running, the page shows instructions. If the app is already running, `npm run dev` detects it and exits without starting a duplicate server. The app stores customer data and owner authentication in MySQL. The username is remembered in the browser; the password is never stored there. Sign in with your password after closing and reopening the app. The owner can also explicitly sign out. `npm run dev` starts Node's built-in file watcher, and `npm test` runs the automated tests.

## Deploy to Vercel

The Vercel deployment uses a serverless Node.js function and a separate, internet-reachable MySQL database. It cannot connect to MySQL running in XAMPP on your computer. The hosted database and local XAMPP database are separate; use the import/export commands below to copy records between them.

1. Create a managed MySQL database that accepts connections from Vercel. Create an empty database and run `credit_tracker_cloud.sql` in its SQL console.
2. In Vercel, configure these Production Environment Variables for the project:
   - `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, and `DB_PASSWORD` from the database provider.
   - `DB_SSL=true` when the provider requires TLS (recommended for hosted MySQL).
   - `OWNER_SETUP_KEY` set to a long, random secret. This protects first-time owner setup on the public site.
3. Deploy this project to Vercel with the repository root as the project root. `vercel.json` routes the static app and API function.
4. On first visit, enter `OWNER_SETUP_KEY` in the setup form and create the hosted owner account. Do not share the setup key or database credentials.
5. To copy the local XAMPP records, first export them with `npm run db:export-json`. Copy `.env.cloud.example` to `.env.cloud`, fill in the hosted database credentials locally, then run `npm run db:import-cloud`. This replaces the hosted store settings, customers, applications, and transactions with the exported JSON data. Owner accounts and sessions are not copied; create the owner account on the hosted deployment.

Keep `.env.cloud` private; it is ignored by Git. Do not put database credentials or `OWNER_SETUP_KEY` in source files. Importing JSON replaces the hosted records, so export or back up the destination first if it already contains data.

### Reset a forgotten owner password

1. Make sure MySQL is running in XAMPP.
2. Open a VS Code terminal in the project folder and run `npm run owner:reset-password`.
3. Enter and confirm a new password when prompted. The input is masked.
4. Sign in using the existing owner username and new password. The reset automatically signs out other sessions.

The reset command changes only the owner password hash and revokes existing sign-in sessions. It does not remove or modify customers, applications, or transactions.

## Features

- Dashboard for total outstanding credit, payments collected this month, overdue balances, pending applications, recent entries, and largest balances.
- Searchable customer list and customer account history.
- Customer applications with owner approval before an account is created.
- Credit-limit checks, account suspension and reactivation, credit entries, payments, and audited entry voids.
- Overdue account list with overdue-day counts and copyable reminder messages.
- One-time owner-account setup, password-only sign-in on a remembered browser, and sign-out.
- Server-side password hashing, browser-session cookies, request-origin checks, and sign-in rate limiting.
- Input validation, JSON API error responses, request-body limits, MySQL transactions, and relational integrity constraints.

## Project layout

```text
data/
  db.json             JSON backup/import file
credit_tracker.sql    XAMPP/phpMyAdmin schema and sample records
credit_tracker_cloud.sql  Managed-MySQL schema for Vercel
public/
  index.html          Frontend entry point
  css/styles.css      Responsive interface styles
  js/app.js           Frontend rendering and API calls
src/
  server.js           Node.js server, static files, and JSON API
  auth.js             Owner password hashing and browser sessions
  mysql-database.js   XAMPP-compatible MySQL connection pool
  mysql-store.js      Transactional customer and credit persistence
  store.js            JSON-backed test adapter
scripts/
  dev.js              Detect an already-running local dev server
  json-to-mysql.js    Import data/db.json into MySQL
  mysql-to-json.js    Export MySQL records to data/db.json
  reset-owner-password.js  Reset owner password securely from the terminal
test/
  database/data.json  JSON description of the MySQL schema and sample records
  server.test.js      Node.js built-in test suite
package.json          Run scripts and Node.js version requirement
api/index.js          Vercel serverless API handler
vercel.json           Vercel API and static-file routing
index.php             XAMPP localhost-folder shortcut to the Node.js app
```

MySQL is the live source of truth. Use `npm run db:export-json` to create a JSON backup. Use `npm run db:import-json` to replace the MySQL customer, application, transaction, and store records with the contents of `data/db.json`. **Importing JSON replaces those records in the database**, so export or back up your data first.

## Local access

The server listens only on `127.0.0.1` and is intended for a trusted local computer. Keep `.env` private and do not expose XAMPP/phpMyAdmin or the app to the public internet. For production hosting, configure HTTPS (`NODE_ENV=production` enables secure session cookies) and review the deployment security settings.
