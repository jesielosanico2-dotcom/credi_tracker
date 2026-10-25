const view = document.querySelector("#view");
const modal = document.querySelector("#modal");
const modalForm = document.querySelector("#modal-form");
const modalFields = document.querySelector("#modal-fields");
const notice = document.querySelector("#notice");
let activePage = "dashboard";
let currentCustomerId = null;
let modalAction = null;
let noticeTimer = null;

const pageTitles = {
  dashboard: "Dashboard",
  customers: "Customers",
  applications: "Applications",
  overdue: "Overdue accounts"
};

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[character]);
}

function localDateString(date = new Date()) {
  const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return localDate.toISOString().slice(0, 10);
}

function money(value) {
  return new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP",
    minimumFractionDigits: 2
  }).format(value || 0);
}

function shortDate(value) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-PH", {
    month: "short",
    day: "numeric",
    year: "numeric"
  }).format(new Date(`${value.slice(0, 10)}T12:00:00`));
}

function initials(name) {
  return name.split(/\s+/).slice(0, 2).map((part) => part.charAt(0)).join("").toUpperCase();
}

async function api(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers
    }
  });
  const result = await response.json();
  if (!response.ok) {
    const error = new Error(result.error || "The request could not be completed.");
    error.status = response.status;
    throw error;
  }
  return result;
}

function rememberedUsername() {
  try {
    return localStorage.getItem("credit-tracker-owner") || "";
  } catch {
    return "";
  }
}

function rememberUsername(username) {
  try {
    localStorage.setItem("credit-tracker-owner", username);
  } catch {
    return;
  }
}

function showAuthScreen(setupRequired, errorMessage = "", setupKeyRequired = false) {
  const username = rememberedUsername();
  document.body.innerHTML = `
    <main class="auth-shell">
      <section class="auth-card">
        <a class="brand auth-brand" href="/" aria-label="Credit Tracker home">
          <img class="brand-logo" src="/images/store-logo.png" alt="Burnico neighborhood store logo">
          <span class="brand-copy"><strong>Credit Tracker</strong><small>BURNICO SARI-SARI Store</small></span>
        </a>
        <p class="eyebrow">${setupRequired ? "FIRST-TIME SETUP" : "PRIVATE STORE ACCOUNT"}</p>
        <h1>${setupRequired ? "Create your owner account" : "Welcome back"}</h1>
        <p class="auth-description">${setupRequired
          ? setupKeyRequired
            ? "Enter your deployment setup key, then set a username and strong password."
            : "Set a username and strong password to protect your store and customer records."
          : username
          ? "Enter your password to sign in."
            : "Sign in with your owner username and password."}</p>
        ${errorMessage ? `<p class="auth-error" role="alert">${escapeHtml(errorMessage)}</p>` : ""}
        <form id="auth-form" class="form-fields" autocomplete="on">
          ${setupRequired && setupKeyRequired ? field("Deployment setup key", "setupKey", "password", {
            required: true,
            max: "256",
            placeholder: "Enter the key configured in Vercel"
          }) : ""}
          ${field("Owner username", "username", "text", {
            required: true,
            max: "40",
            value: username,
            placeholder: "Letters, numbers, dots, or hyphens"
          })}
          ${field("Password", "password", "password", {
            required: true,
            minLength: setupRequired ? "12" : undefined,
            max: "128",
            placeholder: setupRequired ? "At least 12 characters" : "Enter your password"
          })}
          ${setupRequired ? field("Confirm password", "confirmPassword", "password", {
            required: true,
            minLength: "12",
            max: "128",
            placeholder: "Enter your password again"
          }) : ""}
          <button class="button button-primary auth-submit" type="submit">${setupRequired ? "Create account" : "Sign in"}</button>
        </form>
        <p class="auth-session-note">For your security, signing in ends when you close your browser. You will need your password again next time.</p>
      </section>
    </main>`;

  const form = document.querySelector("#auth-form");
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const submit = form.querySelector('[type="submit"]');
    const formData = new FormData(form);
    const values = Object.fromEntries(formData);
    if (setupRequired && values.password !== values.confirmPassword) {
      showAuthScreen(true, "The passwords do not match.", setupKeyRequired);
      return;
    }
    delete values.confirmPassword;
    submit.disabled = true;
    try {
      const result = await api(setupRequired ? "/api/auth/setup" : "/api/auth/login", {
        method: "POST",
        body: JSON.stringify(values)
      });
      rememberUsername(result.username);
      const authShell = document.querySelector(".auth-shell");
      authShell.classList.add("login-success");
      await new Promise((resolve) => window.setTimeout(resolve, 720));
      window.location.reload();
    } catch (error) {
      showAuthScreen(setupRequired, error.message, setupKeyRequired);
    }
  });

}

function showNotice(message, isError = false) {
  window.clearTimeout(noticeTimer);
  notice.textContent = message;
  notice.hidden = false;
  notice.classList.toggle("is-error", isError);
  noticeTimer = window.setTimeout(() => { notice.hidden = true; }, 5000);
}

function statusPill(status) {
  const className = {
    Overdue: "status-overdue",
    "Paid up": "status-paid",
    "Balance due": "status-due",
    Suspended: "status-suspended"
  }[status] || "status-suspended";
  return `<span class="status-pill ${className}">${escapeHtml(status)}</span>`;
}

function navTo(page) {
  activePage = page;
  currentCustomerId = null;
  render();
}

function setPageHeading(title) {
  document.querySelector("#page-title").textContent = title;
  document.querySelectorAll(".nav-link").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.page === activePage);
  });
}

async function render() {
  setPageHeading(pageTitles[activePage] || "Customer account");
  view.innerHTML = '<div class="loading-state">Loading your store…</div>';
  try {
    if (activePage === "dashboard") await renderDashboard();
    else if (activePage === "customers") await renderCustomers();
    else if (activePage === "applications") await renderApplications();
    else if (activePage === "overdue") await renderOverdue();
    else if (activePage === "account") await renderAccount();
  } catch (error) {
    if (error.status === 401) {
      showAuthScreen(false, "Your sign-in has ended. Enter your password to continue.");
      return;
    }
    view.innerHTML = `<div class="panel empty-state">Could not load this view: ${escapeHtml(error.message)}</div>`;
  }
}

function renderMetric(label, value, foot, icon, modifier = "") {
  return `<article class="metric-card ${modifier}">
    <div class="metric-head">${label}<span class="metric-icon" aria-hidden="true">${icon}</span></div>
    <div class="metric-value">${value}</div>
    <div class="metric-foot">${foot}</div>
  </article>`;
}

async function renderDashboard() {
  const data = await api("/api/dashboard");
  document.querySelector("#store-name").textContent = "BURNICO SARI-SARI Store";
  document.querySelector("#today-label").textContent = shortDate(data.asOf).toUpperCase();
  document.querySelector("#application-badge").textContent = data.metrics.pendingApplications || "";

  const activity = data.recentActivity.length
    ? data.recentActivity.map((item) => `<div class="activity-row">
        <span class="activity-avatar">${item.type === "payment" ? "↓" : "↑"}</span>
        <span class="activity-description">
          <strong>${escapeHtml(item.customerName)}</strong>
          <small>${escapeHtml(item.note || (item.type === "credit" ? "Credit added" : "Payment received"))} · ${shortDate(item.date)}</small>
        </span>
        <span class="activity-amount ${item.type === "payment" ? "amount-payment" : "amount-credit"}">${item.type === "payment" ? "−" : "+"}${money(item.amount)}</span>
      </div>`).join("")
    : '<div class="empty-state">No activity yet. Add your first customer entry to get started.</div>';

  const debtors = data.topDebtors.length
    ? data.topDebtors.map((customer) => {
        const used = customer.creditLimit ? Math.min(100, customer.balance / customer.creditLimit * 100) : 0;
        return `<div class="debtor-row">
          <div class="debtor-details"><span>${escapeHtml(customer.name)}</span><span>${money(customer.balance)}</span></div>
          <svg class="progress-track" viewBox="0 0 100 5" preserveAspectRatio="none" role="img" aria-label="${Math.round(used)} percent of the credit limit used"><rect width="${used}" height="5" rx="2.5"></rect></svg>
          <div class="progress-caption">${Math.round(used)}% of ${money(customer.creditLimit)} limit</div>
        </div>`;
      }).join("")
    : '<div class="empty-state">No outstanding customer balances.</div>';

  view.innerHTML = `
    <div class="metric-grid">
      ${renderMetric("Total credit outstanding", money(data.metrics.totalOutstanding), `${data.metrics.customersWithBalance} customers with a balance`, "₱")}
      ${renderMetric("Collected this month", money(data.metrics.collectedThisMonth), "Payments received this month", "↓")}
      ${renderMetric("Overdue", money(data.metrics.overdue), "Past their due date", "◷", "is-alert")}
      ${renderMetric("Waiting for decision", data.metrics.pendingApplications, "Credit applications", "▤", "is-warm")}
    </div>
    <div class="dashboard-grid">
      <section class="panel">
        <div class="panel-heading"><div><h2>Recent activity</h2><p>Latest customer credit and payment entries</p></div>
          <button class="text-button" data-page-link="customers">All customers →</button></div>
        <div class="activity-list">${activity}</div>
      </section>
      <section class="panel">
        <div class="panel-heading"><div><h2>Who owes the most</h2><p>Outstanding balances against credit limits</p></div></div>
        <div>${debtors}</div>
      </section>
    </div>`;
}

function customerRow(customer) {
  const used = customer.creditLimit ? Math.min(100, customer.balance / customer.creditLimit * 100) : 0;
  return `<tr>
    <td><span class="customer-name"><strong>${escapeHtml(customer.name)}</strong><small>${escapeHtml(customer.purok)}${customer.phone ? ` · ${escapeHtml(customer.phone)}` : ""}</small></span></td>
    <td><strong>${money(customer.balance)}</strong></td>
    <td><span class="credit-meter"><small>${money(customer.balance)} / ${money(customer.creditLimit)}</small><svg class="progress-track" viewBox="0 0 100 5" preserveAspectRatio="none" role="img" aria-label="${Math.round(used)} percent of the credit limit used"><rect width="${used}" height="5" rx="2.5"></rect></svg></span></td>
    <td>${statusPill(customer.status)}</td>
    <td><span class="table-actions">
      <button class="button button-primary button-small" data-action="manage" data-id="${escapeHtml(customer.id)}">Manage</button>
      <button class="button button-secondary button-small" data-action="credit" data-id="${escapeHtml(customer.id)}">Add credit</button>
      <button class="button button-secondary button-small" data-action="payment" data-id="${escapeHtml(customer.id)}">Payment</button>
    </span></td>
  </tr>`;
}

async function renderCustomers(search = "") {
  const { customers } = await api(`/api/customers?search=${encodeURIComponent(search)}`);
  view.innerHTML = `
    <section class="panel">
      <div class="panel-heading"><div><h2>Customer accounts</h2><p>Balances, credit usage, and account status at a glance.</p></div></div>
      <div class="section-toolbar">
        <input class="search-field" id="customer-search" type="search" placeholder="Search name, phone, or purok…" value="${escapeHtml(search)}" aria-label="Search customers">
        <button class="button button-primary" data-action="new-customer">＋ New customer</button>
      </div>
      <div class="table-wrap"><table class="data-table">
        <thead><tr><th>Customer</th><th>Balance</th><th>Credit used</th><th>Status</th><th>Actions</th></tr></thead>
        <tbody>${customers.map(customerRow).join("") || '<tr><td colspan="5"><div class="empty-state">No customers found.</div></td></tr>'}</tbody>
      </table></div>
    </section>`;
  document.querySelector("#customer-search").addEventListener("input", (event) => {
    const input = event.currentTarget;
    window.clearTimeout(input.searchTimer);
    input.searchTimer = window.setTimeout(() => renderCustomers(input.value).catch((error) => showNotice(error.message, true)), 160);
  });
}

function transactionRow(transaction) {
  const voided = Boolean(transaction.voidedAt);
  const credit = transaction.type === "credit";
  return `<tr>
    <td>${shortDate(transaction.date)}</td>
    <td>${credit ? "Credit" : "Payment"}${voided ? ' <span class="table-muted">(voided)</span>' : ""}</td>
    <td>${escapeHtml(transaction.note || "—")}${transaction.voidReason ? `<br><span class="table-muted">Voided: ${escapeHtml(transaction.voidReason)}</span>` : ""}</td>
    <td>${credit ? shortDate(transaction.dueDate) : "—"}</td>
    <td class="${credit ? "amount-credit" : "amount-payment"}">${credit ? "+" : "−"}${money(transaction.amount)}</td>
    <td>${voided ? "" : `<button class="button button-quiet button-small" data-action="void" data-id="${escapeHtml(transaction.id)}">Void entry</button>`}</td>
  </tr>`;
}

async function renderAccount() {
  const { customer, transactions } = await api(`/api/customers/${encodeURIComponent(currentCustomerId)}`);
  setPageHeading(customer.name);
  const available = Math.max(0, customer.creditLimit - customer.balance);
  view.innerHTML = `
    <button class="button button-quiet back-button" data-action="back-customers">← All customers</button>
    <section class="panel">
      <div class="account-top">
        <div class="account-avatar">${escapeHtml(initials(customer.name))}</div>
        <div class="account-title"><h2>${escapeHtml(customer.name)} ${statusPill(customer.status)}</h2>
          <p>${escapeHtml(customer.purok)}${customer.phone ? ` · ${escapeHtml(customer.phone)}` : ""}</p></div>
        <div class="account-actions">
          <button class="button button-secondary button-small" data-action="edit-customer" data-id="${escapeHtml(customer.id)}">Edit account</button>
          <button class="button button-secondary button-small" data-action="credit" data-id="${escapeHtml(customer.id)}">＋ Add credit</button>
          <button class="button button-secondary button-small" data-action="payment" data-id="${escapeHtml(customer.id)}">Record payment</button>
          <button class="button ${customer.status === "active" ? "button-danger" : "button-primary"} button-small" data-action="toggle-suspension" data-id="${escapeHtml(customer.id)}">${customer.status === "active" ? "Suspend" : "Reactivate"}</button>
        </div>
      </div>
      <div class="account-metrics">
        <div class="account-metric"><span>Outstanding balance</span><strong>${money(customer.balance)}</strong></div>
        <div class="account-metric"><span>Credit limit</span><strong>${money(customer.creditLimit)}</strong></div>
        <div class="account-metric"><span>Available credit</span><strong>${money(available)}</strong></div>
      </div>
      <div class="panel-heading"><div><h2>Account history</h2><p>Entries are kept for your records. Voiding an entry recalculates the balance.</p></div></div>
      <div class="table-wrap"><table class="data-table">
        <thead><tr><th>Date</th><th>Entry</th><th>Description</th><th>Due date</th><th>Amount</th><th></th></tr></thead>
        <tbody>${transactions.map(transactionRow).join("") || '<tr><td colspan="6"><div class="empty-state">No account entries yet.</div></td></tr>'}</tbody>
      </table></div>
    </section>`;
}

async function renderApplications() {
  const { applications } = await api("/api/applications");
  document.querySelector("#application-badge").textContent = applications.length || "";
  const cards = applications.map((application) => `<article class="application-card">
    <div class="application-card-top">
      <div><h3>${escapeHtml(application.customerName || "Credit limit review")}</h3>
        <p>${application.type === "newCustomer" ? "New customer · " : "Credit limit request · "}${escapeHtml(application.purok || "")}${application.phone ? ` · ${escapeHtml(application.phone)}` : ""}<br>Received ${shortDate(application.createdAt)}</p></div>
      <span class="status-pill status-due">Pending review</span>
    </div>
    <div class="application-request">Requested credit limit: <strong>${money(application.requestedLimit)}</strong>${application.note ? `<br>${escapeHtml(application.note)}` : ""}</div>
    <div class="card-actions"><button class="button button-primary button-small" data-action="review-application" data-id="${escapeHtml(application.id)}" data-decision="approve">Approve</button>
      <button class="button button-danger button-small" data-action="review-application" data-id="${escapeHtml(application.id)}" data-decision="reject">Reject</button></div>
  </article>`).join("");
  view.innerHTML = `<section class="panel"><div class="panel-heading"><div><h2>Credit applications</h2><p>New customers need approval before they can get credit.</p></div></div>
    <div class="application-list">${cards || '<div class="empty-state">You’re all caught up. No credit applications are waiting.</div>'}</div></section>`;
}

async function renderOverdue() {
  const { customers } = await api("/api/customers");
  const overdueCustomers = customers.filter((customer) => customer.overdue > 0).sort((first, second) => second.daysOverdue - first.daysOverdue);
  const cards = overdueCustomers.map((customer) => {
    const reminder = `Hi ${customer.name}! A friendly reminder po: your ${money(customer.overdue)} credit balance at BURNICO SARI-SARI Store was due on ${shortDate(customer.overdueSince)}. Salamat po!`;
    return `<article class="overdue-card">
      <div class="overdue-card-top"><div><h3>${escapeHtml(customer.name)}</h3><p>${escapeHtml(customer.phone || customer.purok)} · ${customer.daysOverdue} ${customer.daysOverdue === 1 ? "day" : "days"} overdue</p></div>
        <span class="overdue-amount">${money(customer.overdue)}</span></div>
      <div class="reminder-copy">${escapeHtml(reminder)}</div>
      <button class="button button-secondary button-small" data-action="copy-reminder" data-reminder="${escapeHtml(reminder)}">▣ Copy reminder</button>
      <button class="button button-quiet button-small" data-action="manage" data-id="${escapeHtml(customer.id)}">View account</button>
    </article>`;
  }).join("");
  view.innerHTML = `<section class="panel"><div class="panel-heading"><div><h2>Overdue accounts</h2><p>Longest overdue first, with a ready-to-send customer reminder.</p></div><span class="status-pill ${overdueCustomers.length ? "status-overdue" : "status-paid"}">${overdueCustomers.length} ${overdueCustomers.length === 1 ? "account" : "accounts"}</span></div>
    <div class="overdue-grid">${cards || '<div class="empty-state">No accounts are past their due date. Nice work.</div>'}</div></section>`;
}

function field(label, name, type = "text", options = {}) {
  const required = options.required ? "required" : "";
  const min = options.min !== undefined ? `min="${escapeHtml(options.min)}"` : "";
  const max = options.max !== undefined ? `max="${escapeHtml(options.max)}"` : "";
  const step = options.step ? `step="${escapeHtml(options.step)}"` : "";
  const value = options.value !== undefined ? `value="${escapeHtml(options.value)}"` : "";
  const placeholder = options.placeholder ? `placeholder="${escapeHtml(options.placeholder)}"` : "";
  const minLength = options.minLength ? `minlength="${escapeHtml(options.minLength)}"` : "";
  if (type === "select") {
    const choices = options.choices.map((choice) => `<option value="${escapeHtml(choice.value)}" ${choice.value === options.value ? "selected" : ""}>${escapeHtml(choice.label)}</option>`).join("");
    return `<label class="field-label">${escapeHtml(label)}<select class="field-control" name="${escapeHtml(name)}" ${required}>${choices}</select></label>`;
  }
  if (type === "textarea") {
    return `<label class="field-label">${escapeHtml(label)}<textarea class="field-control" name="${escapeHtml(name)}" maxlength="${options.maxLength || 240}" ${required} ${placeholder}>${escapeHtml(options.value || "")}</textarea></label>`;
  }
  return `<label class="field-label">${escapeHtml(label)}<input class="field-control" name="${escapeHtml(name)}" type="${escapeHtml(type)}" ${required} ${min} ${max} ${step} ${minLength} ${value} ${placeholder}></label>`;
}

function openModal(title, fields, action, submitLabel = "Save record") {
  document.querySelector("#modal-title").textContent = title;
  modalFields.innerHTML = fields;
  document.querySelector("#modal-submit").textContent = submitLabel;
  modalAction = action;
  modal.showModal();
}

async function openEntryModal(type, customerId = currentCustomerId) {
  const { customers } = await api("/api/customers");
  const eligible = customers.filter((customer) => customer.status === "Balance due" || customer.status === "Overdue" || customer.status === "Paid up");
  if (!eligible.length) {
    showNotice("Add and approve a customer before recording an account entry.", true);
    return;
  }
  const selected = eligible.find((customer) => customer.id === customerId) || eligible[0];
  const choices = eligible.map((customer) => ({ value: customer.id, label: `${customer.name} — ${money(customer.balance)} balance` }));
  const fields = `${field("Customer", "customerId", "select", { choices, value: selected.id })}
    ${field("Entry type", "type", "select", { choices: [{ value: "credit", label: "Add credit" }, { value: "payment", label: "Record payment" }], value: type })}
    <div class="form-row">${field("Amount (PHP)", "amount", "number", { required: true, min: "0.01", step: "0.01", placeholder: "0.00" })}
    ${field("Date", "date", "date", { required: true, value: localDateString() })}</div>
    <div id="due-date-field">${field("Payment due date", "dueDate", "date", { required: true, value: localDateString(new Date(Date.now() + 7 * 86_400_000)) })}</div>
    ${field("Description (optional)", "note", "textarea", { placeholder: "What was bought or paid?" })}`;
  openModal(type === "payment" ? "Record a payment" : "Add credit", fields, async (formData) => {
    await api("/api/transactions", { method: "POST", body: JSON.stringify(Object.fromEntries(formData)) });
    showNotice(type === "payment" ? "Payment recorded. The customer balance has been updated." : "Credit entry recorded. The customer balance has been updated.");
    await render();
  }, type === "payment" ? "Record payment" : "Add credit");
  const typeSelect = modalFields.querySelector('[name="type"]');
  const dueDateField = modalFields.querySelector("#due-date-field");
  const dueDateInput = dueDateField.querySelector('[name="dueDate"]');
  const setDueDate = () => {
    const isCredit = typeSelect.value === "credit";
    dueDateField.hidden = !isCredit;
    dueDateInput.required = isCredit;
  };
  typeSelect.addEventListener("change", setDueDate);
  setDueDate();
}

function openNewCustomerModal() {
  openModal("New customer application", `
    ${field("Customer name", "name", "text", { required: true, max: "80", placeholder: "Full name" })}
    <div class="form-row">${field("Phone number (optional)", "phone", "tel", { max: "32", placeholder: "09xx xxx xxxx" })}
      ${field("Purok / neighborhood", "purok", "text", { required: true, max: "80", placeholder: "Purok 1" })}</div>
    ${field("Requested credit limit (PHP)", "creditLimit", "number", { required: true, min: "0.01", max: "1000000", step: "0.01", placeholder: "500.00" })}
    ${field("Application note (optional)", "note", "textarea", { placeholder: "Tell us a little about the request." })}`,
  async (formData) => {
    await api("/api/customers", { method: "POST", body: JSON.stringify(Object.fromEntries(formData)) });
    activePage = "applications";
    showNotice("Application submitted. The customer can use credit after approval.");
    await render();
  }, "Submit application");
}

async function openEditCustomerModal(customerId) {
  const { customer } = await api(`/api/customers/${encodeURIComponent(customerId)}`);
  openModal("Manage customer account", `
    ${field("Customer name", "name", "text", { required: true, value: customer.name, max: "80" })}
    <div class="form-row">${field("Phone number", "phone", "tel", { required: true, value: customer.phone, max: "32" })}
      ${field("Purok / neighborhood", "purok", "text", { required: true, value: customer.purok, max: "80" })}</div>
    ${field("Credit limit (PHP)", "creditLimit", "number", { required: true, value: customer.creditLimit, min: "0.01", max: "1000000", step: "0.01" })}`,
  async (formData) => {
    await api(`/api/customers/${encodeURIComponent(customerId)}`, { method: "PATCH", body: JSON.stringify(Object.fromEntries(formData)) });
    showNotice("Customer account updated.");
    await render();
  }, "Save changes");
}

function openVoidModal(transactionId) {
  openModal("Void account entry", `
    <p class="table-muted">Voiding keeps the entry in the customer history while removing it from their balance.</p>
    ${field("Reason for voiding", "reason", "textarea", { required: true, placeholder: "Explain why this entry is being voided." })}`,
  async (formData) => {
    await api(`/api/transactions/${encodeURIComponent(transactionId)}/void`, { method: "POST", body: JSON.stringify(Object.fromEntries(formData)) });
    showNotice("Entry voided. The account balance has been recalculated.");
    await render();
  }, "Void entry");
}

modalForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!modalAction) return;
  const submitButton = document.querySelector("#modal-submit");
  submitButton.disabled = true;
  try {
    await modalAction(new FormData(modalForm));
    modal.close();
    modalAction = null;
  } catch (error) {
    showNotice(error.message, true);
  } finally {
    submitButton.disabled = false;
  }
});

function closeModal() {
  modalAction = null;
  modal.close();
}

document.querySelector("#modal-close").addEventListener("click", closeModal);
document.querySelector("#modal-cancel").addEventListener("click", closeModal);
document.querySelector("#quick-add-button").addEventListener("click", () => {
  openEntryModal("credit").catch((error) => showNotice(error.message, true));
});
document.querySelector("#sign-out-button").addEventListener("click", async () => {
  const button = document.querySelector("#sign-out-button");
  button.disabled = true;
  try {
    await api("/api/auth/logout", { method: "POST", body: "{}" });
    showAuthScreen(false, "You have signed out.");
  } catch (error) {
    button.disabled = false;
    showNotice(error.message, true);
  }
});

document.querySelectorAll(".nav-link").forEach((button) => {
  button.addEventListener("click", () => navTo(button.dataset.page));
});

view.addEventListener("click", async (event) => {
  const pageLink = event.target.closest("[data-page-link]");
  if (pageLink) {
    navTo(pageLink.dataset.pageLink);
    return;
  }
  const button = event.target.closest("[data-action]");
  if (!button) return;
  const { action, id } = button.dataset;
  try {
    if (action === "new-customer") openNewCustomerModal();
    if (action === "manage") {
      currentCustomerId = id;
      activePage = "account";
      await render();
    }
    if (action === "back-customers") navTo("customers");
    if (action === "credit" || action === "payment") await openEntryModal(action === "credit" ? "credit" : "payment", id);
    if (action === "edit-customer") await openEditCustomerModal(id);
    if (action === "void") openVoidModal(id);
    if (action === "toggle-suspension") {
      const { customer } = await api(`/api/customers/${encodeURIComponent(id)}`);
      await api(`/api/customers/${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: JSON.stringify({ status: customer.status === "active" ? "suspended" : "active" })
      });
      showNotice(customer.status === "active" ? "Customer credit has been suspended." : "Customer credit has been reactivated.");
      await render();
    }
    if (action === "review-application") {
      await api(`/api/applications/${encodeURIComponent(id)}/review`, {
        method: "POST",
        body: JSON.stringify({ decision: button.dataset.decision })
      });
      showNotice(button.dataset.decision === "approve" ? "Application approved." : "Application declined.");
      await render();
    }
    if (action === "copy-reminder") {
      await navigator.clipboard.writeText(button.dataset.reminder);
      showNotice("Reminder copied. You can paste it into a message.");
    }
  } catch (error) {
    showNotice(error.message, true);
  }
});

document.querySelector("#today-label").textContent = shortDate(localDateString()).toUpperCase();
async function initialize() {
  try {
    const status = await api("/api/auth/status");
    if (!status.authenticated) {
      showAuthScreen(status.setupRequired, "", status.setupKeyRequired);
      return;
    }
    document.querySelector("#owner-username").textContent = status.username;
    await render();
  } catch {
    showAuthScreen(false, "Could not connect to the server. Check the connection and try again.");
  }
}
initialize();
