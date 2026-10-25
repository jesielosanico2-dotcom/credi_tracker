require("dotenv").config();

const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { URL } = require("node:url");
const { createStore, defaultDataPath } = require("./store");
const { AuthError, createAuth, createMySqlAuth } = require("./auth");
const { createDatabasePool } = require("./mysql-database");
const { createMySqlStore } = require("./mysql-store");

const publicDirectory = path.join(__dirname, "..", "public");
const maxBodyBytes = 1024 * 1024;

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function today() {
  const date = new Date();
  const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return localDate.toISOString().slice(0, 10);
}

function summarizeCustomer(customer, transactions, asOf = today()) {
  const active = transactions
    .filter((transaction) => transaction.customerId === customer.id && !transaction.voidedAt)
    .sort((first, second) => first.date.localeCompare(second.date) || first.createdAt.localeCompare(second.createdAt));

  const balance = active.reduce(
    (total, transaction) => total + (transaction.type === "credit" ? transaction.amount : -transaction.amount),
    0
  );
  const creditLots = [];

  for (const transaction of active) {
    if (transaction.type === "credit") {
      creditLots.push({
        remaining: transaction.amount,
        dueDate: transaction.dueDate
      });
      continue;
    }

    let payment = transaction.amount;
    for (const lot of creditLots) {
      const applied = Math.min(payment, lot.remaining);
      lot.remaining -= applied;
      payment -= applied;
      if (payment <= 0) break;
    }
  }

  const overdue = creditLots.reduce(
    (total, lot) => total + (lot.dueDate && lot.dueDate < asOf ? lot.remaining : 0),
    0
  );
  const overdueSince = creditLots
    .filter((lot) => lot.remaining > 0 && lot.dueDate && lot.dueDate < asOf)
    .map((lot) => lot.dueDate)
    .sort()[0] || null;
  const daysOverdue = overdueSince
    ? Math.floor((Date.parse(`${asOf}T00:00:00Z`) - Date.parse(`${overdueSince}T00:00:00Z`)) / 86_400_000)
    : 0;
  const status = customer.status === "suspended"
    ? "Suspended"
    : balance <= 0
      ? "Paid up"
      : overdue > 0
        ? "Overdue"
        : "Balance due";

  return {
    ...customer,
    balance: Math.max(0, balance),
    creditUsed: Math.max(0, balance),
    overdue,
    overdueSince,
    daysOverdue,
    status
  };
}

function dashboardData(data, asOf = today()) {
  const customers = data.customers.map((customer) => summarizeCustomer(customer, data.transactions, asOf));
  const month = asOf.slice(0, 7);
  const collectedThisMonth = data.transactions.reduce(
    (total, transaction) =>
      total +
      (!transaction.voidedAt && transaction.type === "payment" && transaction.date.startsWith(month)
        ? transaction.amount
        : 0),
    0
  );

  const recentActivity = data.transactions
    .filter((transaction) => !transaction.voidedAt)
    .sort((first, second) => second.date.localeCompare(first.date) || second.createdAt.localeCompare(first.createdAt))
    .slice(0, 8)
    .map((transaction) => ({
      ...transaction,
      customerName: data.customers.find((customer) => customer.id === transaction.customerId)?.name ?? "Unknown customer"
    }));

  return {
    storeName: data.settings.storeName,
    asOf,
    metrics: {
      totalOutstanding: customers.reduce((total, customer) => total + customer.balance, 0),
      collectedThisMonth,
      overdue: customers.reduce((total, customer) => total + customer.overdue, 0),
      pendingApplications: data.applications.filter((application) => application.status === "pending").length,
      customersWithBalance: customers.filter((customer) => customer.balance > 0).length
    },
    recentActivity,
    topDebtors: customers
      .filter((customer) => customer.balance > 0)
      .sort((first, second) => second.balance - first.balance)
      .slice(0, 5)
  };
}

function parseAmount(value, label = "Amount") {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0 || amount > 1_000_000) {
    throw new HttpError(400, `${label} must be greater than 0 and no more than 1,000,000.`);
  }
  return Math.round(amount * 100) / 100;
}

function requireText(value, label, maxLength = 120) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > maxLength) {
    throw new HttpError(400, `${label} is required and must be no more than ${maxLength} characters.`);
  }
  return value.trim();
}

function validateDate(value, label) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new HttpError(400, `${label} must be a valid date.`);
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new HttpError(400, `${label} must be a valid date.`);
  }
  return value;
}

async function readJson(request) {
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBodyBytes) throw new HttpError(413, "Request body is too large.");
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, "Request body must be valid JSON.");
  }
}

function sendJson(response, status, value) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer"
  });
  response.end(JSON.stringify(value));
}

function sessionCookie(token, secure = false) {
  const secureAttribute = secure ? "; Secure" : "";
  return `credit_tracker_session=${token}; Path=/; HttpOnly; SameSite=Strict${secureAttribute}`;
}

function clearedSessionCookie(secure = false) {
  const secureAttribute = secure ? "; Secure" : "";
  return `credit_tracker_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secureAttribute}`;
}

function verifySameOrigin(request) {
  const origin = request.headers.origin;
  if (!origin) return;
  try {
    if (new URL(origin).host !== request.headers.host) {
      throw new HttpError(403, "Cross-origin requests are not allowed.");
    }
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(403, "Invalid request origin.");
  }
}

function findCustomer(data, id) {
  const customer = data.customers.find((item) => item.id === id);
  if (!customer) throw new HttpError(404, "Customer not found.");
  return customer;
}

function createApp(options = {}) {
  const testFileMode = Boolean(options.dataFile);
  const dataFile = options.dataFile || defaultDataPath;
  const pool = options.pool || (testFileMode ? null : createDatabasePool());
  const store = options.store || (pool ? createMySqlStore(pool) : createStore(dataFile));
  const authFile = options.authFile || path.join(path.dirname(dataFile), "auth.json");
  const auth = options.auth || (pool ? createMySqlAuth(pool) : createAuth(authFile));
  const secureCookie = options.secureCookies ?? process.env.NODE_ENV === "production";
  const loginAttempts = new Map();
  const loginAttemptWindowMs = 15 * 60 * 1000;
  const maxLoginAttempts = 5;

  async function handleApi(request, response, url) {
    const route = url.pathname;
    const method = request.method;

    if (route === "/api/health" && method === "GET") {
      sendJson(response, 200, { status: "ok" });
      return;
    }
    if (route === "/api/auth/status" && method === "GET") {
      const [account, session] = await Promise.all([auth.status(), auth.validate(request)]);
      sendJson(response, 200, {
        ...account,
        authenticated: Boolean(session),
        username: session?.username,
        setupKeyRequired: process.env.NODE_ENV === "production"
      });
      return;
    }
    if (route === "/api/auth/setup" && method === "POST") {
      verifySameOrigin(request);
      const body = await readJson(request);
      if (process.env.NODE_ENV === "production") {
        const setupKey = process.env.OWNER_SETUP_KEY;
        if (!setupKey) throw new HttpError(503, "Owner setup is disabled until OWNER_SETUP_KEY is configured.");
        if (body.setupKey !== setupKey) throw new HttpError(403, "The deployment setup key is incorrect.");
      }
      const session = await auth.setup(body.username, body.password);
      response.setHeader("Set-Cookie", sessionCookie(session.token, secureCookie));
      sendJson(response, 201, { username: session.username });
      return;
    }
    if (route === "/api/auth/login" && method === "POST") {
      verifySameOrigin(request);
      const address = request.socket.remoteAddress || "unknown";
      const now = Date.now();
      const attempts = loginAttempts.get(address);
      if (attempts && attempts.resetAt > now && attempts.count >= maxLoginAttempts) {
        response.setHeader("Retry-After", String(Math.ceil((attempts.resetAt - now) / 1000)));
        throw new HttpError(429, "Too many sign-in attempts. Try again in a few minutes.");
      }
      if (!attempts || attempts.resetAt <= now) {
        loginAttempts.set(address, { count: 0, resetAt: now + loginAttemptWindowMs });
      }
      const body = await readJson(request);
      try {
        const session = await auth.login(body.username, body.password);
        loginAttempts.delete(address);
        response.setHeader("Set-Cookie", sessionCookie(session.token, secureCookie));
        sendJson(response, 200, { username: session.username });
      } catch (error) {
        if (error instanceof AuthError && error.status === 401) {
          const updated = loginAttempts.get(address);
          updated.count += 1;
          throw error;
        }
        throw error;
      }
      return;
    }
    if (route === "/api/auth/logout" && method === "POST") {
      verifySameOrigin(request);
      await auth.logout(request);
      response.setHeader("Set-Cookie", clearedSessionCookie(secureCookie));
      sendJson(response, 200, { success: true });
      return;
    }

    const session = await auth.validate(request);
    if (!session) throw new HttpError(401, "Please sign in to continue.");
    if (!["GET", "HEAD"].includes(method)) verifySameOrigin(request);

    const data = await store.read();
    if (route === "/api/dashboard" && method === "GET") {
      sendJson(response, 200, dashboardData(data));
      return;
    }
    if (route === "/api/customers" && method === "GET") {
      const query = (url.searchParams.get("search") || "").trim().toLocaleLowerCase();
      const customers = data.customers
        .map((customer) => summarizeCustomer(customer, data.transactions))
        .filter((customer) => !query || [customer.name, customer.phone, customer.purok].some((value) => value.toLocaleLowerCase().includes(query)));
      sendJson(response, 200, { customers });
      return;
    }
    if (route === "/api/applications" && method === "GET") {
      sendJson(response, 200, {
        applications: data.applications
          .filter((application) => application.status === "pending")
          .sort((first, second) => second.createdAt.localeCompare(first.createdAt))
      });
      return;
    }

    const customerMatch = route.match(/^\/api\/customers\/([^/]+)$/);
    if (customerMatch && method === "GET") {
      const customer = summarizeCustomer(findCustomer(data, customerMatch[1]), data.transactions);
      const transactions = data.transactions
        .filter((transaction) => transaction.customerId === customer.id)
        .sort((first, second) => second.date.localeCompare(first.date) || second.createdAt.localeCompare(first.createdAt));
      sendJson(response, 200, { customer, transactions });
      return;
    }
    if (customerMatch && method === "PATCH") {
      const body = await readJson(request);
      const result = await store.update((current) => {
        const customer = findCustomer(current, customerMatch[1]);
        const updated = { ...customer };
        if (body.name !== undefined) updated.name = requireText(body.name, "Name", 80);
        if (body.phone !== undefined) updated.phone = requireText(body.phone, "Phone", 32);
        if (body.purok !== undefined) updated.purok = requireText(body.purok, "Purok", 80);
        if (body.creditLimit !== undefined) {
          updated.creditLimit = parseAmount(body.creditLimit, "Credit limit");
          const summary = summarizeCustomer(customer, current.transactions);
          if (updated.creditLimit < summary.balance) {
            throw new HttpError(400, "Credit limit cannot be lower than the customer's current balance.");
          }
        }
        if (body.status !== undefined) {
          if (!["active", "suspended"].includes(body.status)) throw new HttpError(400, "Status must be active or suspended.");
          updated.status = body.status;
        }
        Object.assign(customer, updated);
        return summarizeCustomer(customer, current.transactions);
      });
      sendJson(response, 200, { customer: result });
      return;
    }
    if (route === "/api/customers" && method === "POST") {
      const body = await readJson(request);
      const application = await store.update((current) => {
        const applicationRecord = {
          id: randomUUID(),
          type: "newCustomer",
          status: "pending",
          customerName: requireText(body.name, "Name", 80),
          phone: typeof body.phone === "string" ? body.phone.trim().slice(0, 32) : "",
          purok: requireText(body.purok, "Purok", 80),
          requestedLimit: parseAmount(body.creditLimit, "Credit limit"),
          note: typeof body.note === "string" ? body.note.trim().slice(0, 240) : "",
          createdAt: new Date().toISOString()
        };
        current.applications.push(applicationRecord);
        return applicationRecord;
      });
      sendJson(response, 201, { application });
      return;
    }

    if (route === "/api/transactions" && method === "POST") {
      const body = await readJson(request);
      const transaction = await store.update((current) => {
        const customer = findCustomer(current, requireText(body.customerId, "Customer"));
        if (customer.status !== "active") throw new HttpError(400, "This customer's credit account is suspended.");
        if (!["credit", "payment"].includes(body.type)) throw new HttpError(400, "Type must be credit or payment.");
        const amount = parseAmount(body.amount);
        const customerSummary = summarizeCustomer(customer, current.transactions);
        if (body.type === "credit" && customerSummary.balance + amount > customer.creditLimit) {
          throw new HttpError(400, "This entry would exceed the customer's credit limit.");
        }
        if (body.type === "payment" && amount > customerSummary.balance) {
          throw new HttpError(400, "Payment cannot be greater than the customer's outstanding balance.");
        }
        const transactionDate = body.date === undefined ? today() : validateDate(body.date, "Date");
        if (transactionDate > today()) throw new HttpError(400, "Date cannot be in the future.");
        const dueDate = body.type === "credit" ? validateDate(body.dueDate, "Due date") : null;
        if (body.type === "credit" && dueDate < transactionDate) {
          throw new HttpError(400, "Due date cannot be earlier than the transaction date.");
        }
        const entry = {
          id: randomUUID(),
          customerId: customer.id,
          type: body.type,
          amount,
          note: typeof body.note === "string" ? body.note.trim().slice(0, 240) : "",
          date: transactionDate,
          dueDate,
          createdAt: new Date().toISOString(),
          voidedAt: null,
          voidReason: ""
        };
        current.transactions.push(entry);
        return entry;
      });
      sendJson(response, 201, { transaction });
      return;
    }

    const reviewMatch = route.match(/^\/api\/applications\/([^/]+)\/review$/);
    if (reviewMatch && method === "POST") {
      const body = await readJson(request);
      if (!["approve", "reject"].includes(body.decision)) throw new HttpError(400, "Decision must be approve or reject.");
      const result = await store.update((current) => {
        const application = current.applications.find((item) => item.id === reviewMatch[1]);
        if (!application) throw new HttpError(404, "Application not found.");
        if (application.status !== "pending") throw new HttpError(409, "This application has already been reviewed.");
        application.status = body.decision === "approve" ? "approved" : "rejected";
        application.reviewedAt = new Date().toISOString();
        if (body.decision === "approve" && application.type === "newCustomer") {
          const customer = {
            id: randomUUID(),
            name: application.customerName,
            phone: application.phone,
            purok: application.purok,
            creditLimit: application.requestedLimit,
            status: "active",
            createdAt: new Date().toISOString()
          };
          current.customers.push(customer);
          application.customerId = customer.id;
        } else if (body.decision === "approve" && application.type === "limitIncrease") {
          const customer = findCustomer(current, application.customerId);
          customer.creditLimit = application.requestedLimit;
        }
        return application;
      });
      sendJson(response, 200, { application: result });
      return;
    }

    const voidMatch = route.match(/^\/api\/transactions\/([^/]+)\/void$/);
    if (voidMatch && method === "POST") {
      const body = await readJson(request);
      const reason = requireText(body.reason, "Reason", 240);
      const result = await store.update((current) => {
        const transaction = current.transactions.find((item) => item.id === voidMatch[1]);
        if (!transaction) throw new HttpError(404, "Transaction not found.");
        if (transaction.voidedAt) throw new HttpError(409, "This transaction has already been voided.");
        transaction.voidedAt = new Date().toISOString();
        transaction.voidReason = reason;
        return transaction;
      });
      sendJson(response, 200, { transaction: result });
      return;
    }

    if (route.startsWith("/api/")) throw new HttpError(404, "API endpoint not found.");
    sendJson(response, 405, { error: "Method not allowed." });
  }

  async function serveStatic(request, response, url) {
    if (!["GET", "HEAD"].includes(request.method)) {
      throw new HttpError(405, "Method not allowed.");
    }
    let pathname;
    try {
      pathname = decodeURIComponent(url.pathname);
    } catch {
      throw new HttpError(400, "Invalid URL path.");
    }
    const relativePath = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
    const filePath = path.resolve(publicDirectory, relativePath);
    const resolvedRelativePath = path.relative(publicDirectory, filePath);
    if (resolvedRelativePath === ".." || resolvedRelativePath.startsWith(`..${path.sep}`) || path.isAbsolute(resolvedRelativePath)) {
      throw new HttpError(404, "File not found.");
    }
    let content;
    try {
      content = await fs.readFile(filePath);
    } catch (error) {
      if (error.code === "ENOENT" || error.code === "EISDIR") throw new HttpError(404, "File not found.");
      throw error;
    }
    const contentTypes = {
      ".css": "text/css; charset=utf-8",
      ".html": "text/html; charset=utf-8",
      ".js": "text/javascript; charset=utf-8",
      ".json": "application/json; charset=utf-8",
      ".png": "image/png",
      ".svg": "image/svg+xml"
    };
    response.writeHead(200, {
      "Content-Type": contentTypes[path.extname(filePath)] || "application/octet-stream",
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
      "Referrer-Policy": "no-referrer",
      "Content-Security-Policy": "default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:; connect-src 'self'; form-action 'self'; frame-ancestors 'none'"
    });
    response.end(request.method === "HEAD" ? undefined : content);
  }

  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url, "http://localhost");
    try {
      if (url.pathname.startsWith("/api/")) {
        await handleApi(request, response, url);
      } else {
        await serveStatic(request, response, url);
      }
    } catch (error) {
      const expectedError = error instanceof HttpError || error instanceof AuthError;
      if (!expectedError) console.error("Request failed:", error);
      if (!response.headersSent) {
        sendJson(response, expectedError ? error.status : 500, {
          error: expectedError ? error.message : "An unexpected server error occurred."
        });
      } else {
        response.destroy(error);
      }
    }
  });

  if (pool && !options.pool) {
    server.on("close", () => {
      pool.end().catch((error) => console.error("Could not close the MySQL connection pool:", error));
    });
  }

  return server;
}

if (require.main === module) {
  const port = Number(process.env.PORT || 3000);
  const databasePool = createDatabasePool();
  const server = createApp({ pool: databasePool });
  server.on("close", () => {
    databasePool.end().catch((error) => console.error("Could not close the MySQL connection pool:", error));
  });
  createMySqlStore(databasePool).read().then(() => {
    server.listen(port, "127.0.0.1", () => {
      console.log(`Credit Tracker is running at http://127.0.0.1:${port}`);
    });
  }).catch((error) => {
    console.error(`Could not load the Credit Tracker database at ${process.env.DB_HOST || "127.0.0.1"}:${process.env.DB_PORT || "3306"}. Start MySQL in XAMPP, import data/data.sql in phpMyAdmin, and check your .env settings.`);
    console.error(error.message);
    databasePool.end().catch(() => {});
    process.exitCode = 1;
  });
}

module.exports = { createApp, dashboardData, summarizeCustomer };
