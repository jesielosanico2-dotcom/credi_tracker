const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { createApp, summarizeCustomer, dashboardData } = require("../src/server");

const seed = {
  settings: { storeName: "Aling Nena's Sari-Sari Store", currency: "PHP" },
  customers: [
    { id: "cus-maria-santos", name: "Maria Santos", phone: "0917 123 4567", purok: "Purok 3", creditLimit: 1000, status: "active" },
    { id: "cus-juan-dela-cruz", name: "Juan Dela Cruz", phone: "0918 123 4567", purok: "Purok 1", creditLimit: 500, status: "active" },
    { id: "cus-lorna-cruz", name: "Lorna Cruz", phone: "0920 555 0142", purok: "Purok 2", creditLimit: 800, status: "active" },
    { id: "cus-tonyo-bautista", name: "Tonyo Bautista", phone: "0935 777 0198", purok: "Purok 4", creditLimit: 300, status: "active" }
  ],
  applications: [
    {
      id: "app-pedro-reyes",
      type: "newCustomer",
      status: "pending",
      customerName: "Pedro Reyes",
      phone: "",
      purok: "Purok 2",
      requestedLimit: 500,
      note: "New customer credit request",
      createdAt: "2026-10-25T08:00:00.000Z"
    }
  ],
  transactions: [
    { id: "txn-maria-first-credit", customerId: "cus-maria-santos", type: "credit", amount: 200, note: "Rice and canned goods", date: "2026-10-05", dueDate: "2026-10-20", createdAt: "2026-10-05T09:00:00.000Z", voidedAt: null },
    { id: "txn-maria-payment", customerId: "cus-maria-santos", type: "payment", amount: 150, note: "Cash payment", date: "2026-10-12", dueDate: null, createdAt: "2026-10-12T10:00:00.000Z", voidedAt: null },
    { id: "txn-maria-second-credit", customerId: "cus-maria-santos", type: "credit", amount: 300, note: "Cooking oil, sugar, and coffee", date: "2026-10-15", dueDate: "2026-10-30", createdAt: "2026-10-15T09:00:00.000Z", voidedAt: null },
    { id: "txn-juan-credit", customerId: "cus-juan-dela-cruz", type: "credit", amount: 120, note: "Noodles and soft drinks", date: "2026-10-12", dueDate: "2026-10-22", createdAt: "2026-10-12T09:00:00.000Z", voidedAt: null },
    { id: "txn-juan-payment", customerId: "cus-juan-dela-cruz", type: "payment", amount: 120, note: "Paid in full", date: "2026-10-18", dueDate: null, createdAt: "2026-10-18T11:00:00.000Z", voidedAt: null },
    { id: "txn-lorna-credit", customerId: "cus-lorna-cruz", type: "credit", amount: 450, note: "Household groceries", date: "2026-10-08", dueDate: "2026-10-13", createdAt: "2026-10-08T09:00:00.000Z", voidedAt: null },
    { id: "txn-tonyo-credit", customerId: "cus-tonyo-bautista", type: "credit", amount: 280, note: "Canned goods and bread", date: "2026-10-20", dueDate: "2026-10-30", createdAt: "2026-10-20T09:00:00.000Z", voidedAt: null }
  ]
};

function dateAfter(days) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return localDate.toISOString().slice(0, 10);
}

async function withServer(run) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "credit-tracker-test-"));
  const dataFile = path.join(directory, "db.json");
  await fs.writeFile(dataFile, `${JSON.stringify(seed, null, 2)}\n`);
  const server = createApp({ dataFile });

  try {
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const setup = await requestJson(baseUrl, "/api/auth/setup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "store.owner", password: "secure-test-password-123" })
    });
    assert.equal(setup.status, 201);
    const cookie = setup.headers.get("set-cookie").split(";")[0];
    const request = (route, options = {}) => requestJson(baseUrl, route, {
      ...options,
      headers: { ...options.headers, Cookie: cookie }
    });
    await run(baseUrl, dataFile, request);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await fs.rm(directory, { recursive: true, force: true });
  }
}

async function requestJson(baseUrl, route, options) {
  const response = await fetch(`${baseUrl}${route}`, options);
  return { status: response.status, body: await response.json(), headers: response.headers };
}

test("seed data rolls up balances, collections, and oldest-due payments", () => {
  const maria = seed.customers.find((customer) => customer.id === "cus-maria-santos");
  const summary = summarizeCustomer(maria, seed.transactions, "2026-10-25");
  const dashboard = dashboardData(seed, "2026-10-25");

  assert.equal(summary.balance, 350);
  assert.equal(summary.overdue, 50);
  assert.equal(summary.daysOverdue, 5);
  assert.equal(dashboard.metrics.totalOutstanding, 1080);
  assert.equal(dashboard.metrics.collectedThisMonth, 270);
  assert.equal(dashboard.metrics.overdue, 500);
  assert.equal(dashboard.metrics.pendingApplications, 1);
});

test("the dashboard endpoint returns the current JSON-backed store summary", async () => {
  await withServer(async (baseUrl, dataFile, request) => {
    const unauthenticated = await requestJson(baseUrl, "/api/dashboard");
    assert.equal(unauthenticated.status, 401);
    const { status, body } = await request("/api/dashboard");
    assert.equal(status, 200);
    assert.equal(body.storeName, "Aling Nena's Sari-Sari Store");
    assert.equal(body.metrics.totalOutstanding, 1080);
    assert.equal(body.metrics.collectedThisMonth, 270);
  });
});

test("a new customer application creates a customer only after approval", async () => {
  await withServer(async (baseUrl, dataFile, request) => {
    const submitted = await request("/api/customers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Ana Reyes", phone: "0918 000 0000", purok: "Purok 5", creditLimit: 600 })
    });
    assert.equal(submitted.status, 201);
    assert.equal(submitted.body.application.status, "pending");

    const beforeReview = await request("/api/customers");
    assert.equal(beforeReview.body.customers.some((customer) => customer.name === "Ana Reyes"), false);

    const reviewed = await request(`/api/applications/${submitted.body.application.id}/review`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision: "approve" })
    });
    assert.equal(reviewed.status, 200);
    assert.equal(reviewed.body.application.status, "approved");

    const afterReview = await request("/api/customers");
    const ana = afterReview.body.customers.find((customer) => customer.name === "Ana Reyes");
    assert.equal(ana.creditLimit, 600);
    assert.equal(ana.balance, 0);

    const savedData = JSON.parse(await fs.readFile(dataFile, "utf8"));
    assert.ok(savedData.customers.some((customer) => customer.id === ana.id));
  });
});

test("credit, payment, and void operations recalculate balances and persist", async () => {
  await withServer(async (baseUrl, dataFile, request) => {
    const credit = await request("/api/transactions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        customerId: "cus-maria-santos",
        type: "credit",
        amount: 20,
        date: dateAfter(0),
        dueDate: dateAfter(7),
        note: "Extra groceries"
      })
    });
    assert.equal(credit.status, 201);

    const payment = await request("/api/transactions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        customerId: "cus-maria-santos",
        type: "payment",
        amount: 70,
        date: dateAfter(0),
        note: "Partial payment"
      })
    });
    assert.equal(payment.status, 201);

    const accountAfterPayment = await request("/api/customers/cus-maria-santos");
    assert.equal(accountAfterPayment.body.customer.balance, 300);

    const voided = await request(`/api/transactions/${credit.body.transaction.id}/void`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: "Incorrect amount" })
    });
    assert.equal(voided.status, 200);

    const accountAfterVoid = await request("/api/customers/cus-maria-santos");
    assert.equal(accountAfterVoid.body.customer.balance, 280);
    assert.equal(accountAfterVoid.body.transactions.find((item) => item.id === credit.body.transaction.id).voidReason, "Incorrect amount");
  });
});

test("invalid and over-limit transactions return useful validation errors", async () => {
  await withServer(async (baseUrl, dataFile, request) => {
    const overLimit = await request("/api/transactions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        customerId: "cus-tonyo-bautista",
        type: "credit",
        amount: 100,
        date: dateAfter(0),
        dueDate: dateAfter(7)
      })
    });
    assert.equal(overLimit.status, 400);
    assert.match(overLimit.body.error, /credit limit/i);

    const malformed = await request("/api/transactions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{invalid"
    });
    assert.equal(malformed.status, 400);
    assert.match(malformed.body.error, /valid JSON/i);
  });
});

test("owner setup is one time and the next sign-in accepts the password only", async () => {
  await withServer(async (baseUrl, dataFile, request) => {
    const duplicateSetup = await request("/api/auth/setup", {
      method: "POST",
      body: JSON.stringify({ username: "another.owner", password: "another-secure-password" })
    });
    assert.equal(duplicateSetup.status, 409);

    const login = await requestJson(baseUrl, "/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: "secure-test-password-123" })
    });
    assert.equal(login.status, 200);
    assert.equal(login.body.username, "store.owner");
    assert.match(login.headers.get("set-cookie"), /HttpOnly/);
    assert.match(login.headers.get("set-cookie"), /SameSite=Strict/);

    const authenticated = await requestJson(baseUrl, "/api/customers", {
      headers: { Cookie: login.headers.get("set-cookie").split(";")[0] }
    });
    assert.equal(authenticated.status, 200);

    const incorrectPassword = await requestJson(baseUrl, "/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: "incorrect-password" })
    });
    assert.equal(incorrectPassword.status, 401);

    for (let attempt = 0; attempt < 4; attempt += 1) {
      const failedAttempt = await requestJson(baseUrl, "/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: "incorrect-password" })
      });
      assert.equal(failedAttempt.status, 401);
    }
    const rateLimited = await requestJson(baseUrl, "/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: "incorrect-password" })
    });
    assert.equal(rateLimited.status, 429);

    const logout = await requestJson(baseUrl, "/api/auth/logout", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: login.headers.get("set-cookie").split(";")[0]
      },
      body: "{}"
    });
    assert.equal(logout.status, 200);
    const revokedSession = await requestJson(baseUrl, "/api/customers", {
      headers: { Cookie: login.headers.get("set-cookie").split(";")[0] }
    });
    assert.equal(revokedSession.status, 401);

    const data = JSON.parse(await fs.readFile(path.join(path.dirname(dataFile), "auth.json"), "utf8"));
    assert.notEqual(data.owner.passwordHash, "secure-test-password-123");
    assert.equal(JSON.stringify(data).includes("secure-test-password-123"), false);
    assert.equal(data.sessions.length, 0);
  });
});

test("production owner setup requires the deployment key", async () => {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousSetupKey = process.env.OWNER_SETUP_KEY;
  process.env.NODE_ENV = "production";
  process.env.OWNER_SETUP_KEY = "test-deployment-setup-key";

  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "credit-tracker-production-setup-"));
  const dataFile = path.join(directory, "db.json");
  await fs.writeFile(dataFile, `${JSON.stringify(seed, null, 2)}\n`);
  const server = createApp({ dataFile });

  try {
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const status = await requestJson(baseUrl, "/api/auth/status");
    assert.equal(status.body.setupKeyRequired, true);

    const rejectedSetup = await requestJson(baseUrl, "/api/auth/setup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "store.owner", password: "secure-test-password-123" })
    });
    assert.equal(rejectedSetup.status, 403);

    const setup = await requestJson(baseUrl, "/api/auth/setup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        setupKey: "test-deployment-setup-key",
        username: "store.owner",
        password: "secure-test-password-123"
      })
    });
    assert.equal(setup.status, 201);
    assert.match(setup.headers.get("set-cookie"), /Secure/);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await fs.rm(directory, { recursive: true, force: true });
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
    if (previousSetupKey === undefined) delete process.env.OWNER_SETUP_KEY;
    else process.env.OWNER_SETUP_KEY = previousSetupKey;
  }
});
