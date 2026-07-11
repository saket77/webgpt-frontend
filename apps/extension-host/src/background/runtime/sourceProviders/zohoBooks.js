import { ZOHO_BOOKS_TOKEN_STORAGE_KEY } from "../../config.js";
import { getZohoBooksConfiguration } from "../../settings/zohoBooksConfig.js";

const ZOHO_BOOKS_PROVIDER = "zoho_books";
const ZOHO_BOOKS_AUDIT = "zoho_books_audit";
const PAGE_SIZE = 200;
let interactiveAuthPromise = null;

function normalizeText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function normalizeKey(value) {
  return normalizeText(value).toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function base64UrlEncodeBytes(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function randomBase64Url(byteLength = 24) {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return base64UrlEncodeBytes(bytes);
}

function zohoSetupError() {
  return new Error(
    "Zoho Books OAuth is not configured. Open WebGPT Settings, add the Zoho OAuth client ID, client secret, and data center, then add the displayed redirect URI to the Zoho API Console client.",
  );
}

async function getZohoConfig() {
  const config = await getZohoBooksConfiguration();
  return {
    ...config,
    dataCenter: normalizeText(config.dataCenter || "in"),
    accountsUrl: normalizeText(config.accountsUrl),
    apiDomain: normalizeText(config.apiDomain),
    clientId: normalizeText(config.clientId),
    clientSecret: normalizeText(config.clientSecret),
    scopes: Array.isArray(config.scopes)
      ? config.scopes.map(normalizeText).filter(Boolean)
      : [],
  };
}

async function isZohoConfigured() {
  const config = await getZohoConfig();
  return Boolean(config.configured && config.clientId && config.clientSecret);
}

async function readStoredToken() {
  const stored = await chrome.storage.local.get(ZOHO_BOOKS_TOKEN_STORAGE_KEY);
  return stored?.[ZOHO_BOOKS_TOKEN_STORAGE_KEY] || null;
}

async function saveStoredToken(token) {
  await chrome.storage.local.set({
    [ZOHO_BOOKS_TOKEN_STORAGE_KEY]: token,
  });
}

async function clearStoredToken() {
  await chrome.storage.local.remove(ZOHO_BOOKS_TOKEN_STORAGE_KEY);
}

function isAccessTokenFresh(token) {
  return Boolean(
    token?.accessToken &&
      Number(token.expiresAt || 0) > Date.now() + 60_000,
  );
}

function buildStoredToken(json, config, previous = {}) {
  return {
    accessToken: json.access_token || "",
    refreshToken: json.refresh_token || previous.refreshToken || "",
    tokenType: json.token_type || "Bearer",
    apiDomain: json.api_domain || previous.apiDomain || config.apiDomain,
    dataCenter: config.dataCenter,
    scope: json.scope || previous.scope || config.scopes.join(","),
    expiresAt: Date.now() + Math.max(60, Number(json.expires_in || 3600)) * 1000,
    savedAt: Date.now(),
  };
}

async function tokenRequest(params, previous = {}) {
  const config = await getZohoConfig();
  const url = new URL(`${config.accountsUrl}/oauth/v2/token`);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, value);
    }
  }

  const response = await fetch(url.toString(), {
    method: "POST",
    headers: {
      "Content-Type": "application/data",
    },
  });
  const json = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(
      json?.error_description ||
        json?.error ||
        `Zoho token request failed with status ${response.status}.`,
    );
  }

  const token = buildStoredToken(json || {}, config, previous);
  await saveStoredToken(token);
  return token;
}

async function refreshAccessToken(storedToken) {
  const config = await getZohoConfig();
  return tokenRequest(
    {
      client_id: config.clientId,
      client_secret: config.clientSecret,
      grant_type: "refresh_token",
      refresh_token: storedToken.refreshToken,
    },
    storedToken,
  );
}

function parseLaunchRedirect(redirectUrl, expectedState) {
  if (!redirectUrl) throw new Error("Zoho authorization was cancelled.");
  const parsed = new URL(redirectUrl);
  const error = parsed.searchParams.get("error");
  if (error) {
    throw new Error(
      parsed.searchParams.get("error_description") ||
        `Zoho authorization failed: ${error}`,
    );
  }
  if ((parsed.searchParams.get("state") || "") !== expectedState) {
    throw new Error("Zoho authorization returned an invalid state.");
  }
  const code = parsed.searchParams.get("code") || "";
  if (!code) throw new Error("Zoho did not return an authorization code.");
  return code;
}

async function interactiveAuthorize() {
  if (!chrome.identity?.launchWebAuthFlow) {
    throw new Error("Chrome identity launchWebAuthFlow is unavailable.");
  }
  if (!(await isZohoConfigured())) throw zohoSetupError();

  const config = await getZohoConfig();
  const redirectUri = chrome.identity.getRedirectURL("zoho-books");
  const state = randomBase64Url(24);
  const params = new URLSearchParams({
    scope: config.scopes.join(","),
    client_id: config.clientId,
    state,
    response_type: "code",
    redirect_uri: redirectUri,
    access_type: "offline",
    prompt: "consent",
  });

  const redirectUrl = await chrome.identity.launchWebAuthFlow({
    url: `${config.accountsUrl}/oauth/v2/auth?${params.toString()}`,
    interactive: true,
  });
  const code = parseLaunchRedirect(redirectUrl, state);
  return tokenRequest({
    code,
    client_id: config.clientId,
    client_secret: config.clientSecret,
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
  });
}

async function getAccessToken({ interactive = false } = {}) {
  if (!(await isZohoConfigured())) throw zohoSetupError();

  const storedToken = await readStoredToken();
  if (isAccessTokenFresh(storedToken)) return storedToken;

  if (storedToken?.refreshToken) {
    try {
      const refreshed = await refreshAccessToken(storedToken);
      if (refreshed?.accessToken) return refreshed;
    } catch {
      await clearStoredToken();
    }
  }

  if (!interactive) throw new Error("Zoho Books authorization is required.");
  const token = await interactiveAuthorize();
  if (!token?.accessToken) throw new Error("Zoho did not return an access token.");
  return token;
}

function buildQuery(params = {}) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params || {})) {
    if (value === undefined || value === null || value === "") continue;
    query.set(key, String(value));
  }
  return query.toString();
}

async function zohoFetch(path, { query = {}, retry = true } = {}) {
  const token = await getAccessToken({ interactive: false });
  const cleanPath = String(path || "").startsWith("/") ? path : `/${path}`;
  const queryString = buildQuery(query);
  const url = `${token.apiDomain}/books/v3${cleanPath}${queryString ? `?${queryString}` : ""}`;
  const response = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Zoho-oauthtoken ${token.accessToken}`,
    },
  });

  if (response.status === 401 && retry) {
    await clearStoredToken();
    return zohoFetch(path, { query, retry: false });
  }

  const json = await response.json().catch(() => null);
  if (!response.ok || Number(json?.code || 0) !== 0) {
    throw new Error(
      json?.message ||
        json?.error ||
        `Zoho Books request failed for ${cleanPath} with status ${response.status}.`,
    );
  }
  return json || {};
}

function firstArray(json, preferredKeys = []) {
  for (const key of preferredKeys) {
    if (Array.isArray(json?.[key])) return json[key];
  }
  const key = Object.keys(json || {}).find((candidate) =>
    Array.isArray(json[candidate]),
  );
  return key ? json[key] : [];
}

async function fetchAllPages(path, { query = {}, resultKeys = [] } = {}) {
  const rows = [];
  for (let page = 1; page <= 25; page += 1) {
    const json = await zohoFetch(path, {
      query: {
        ...query,
        page,
        per_page: PAGE_SIZE,
      },
    });
    rows.push(...firstArray(json, resultKeys));
    const pageContext = json.page_context || json.pageContext || {};
    if (!pageContext.has_more_page && !pageContext.hasMorePage) break;
  }
  return rows;
}

async function safeFetchAllPages(path, options, diagnostics, label) {
  try {
    return await fetchAllPages(path, options);
  } catch (error) {
    diagnostics.push(`${label}: ${error?.message || String(error)}`);
    return [];
  }
}

function pick(row = {}, keys = []) {
  for (const key of keys) {
    const value = row?.[key];
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return "";
}

function amount(value) {
  const parsed = Number(String(value ?? "").replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function dateInPeriodQuery(period = {}) {
  return {
    date_start: period.startDate,
    date_end: period.endDate,
  };
}

function sourceSheet(kind, title, values) {
  return { kind, title, values };
}

function chartOfAccountsSheet(accounts = []) {
  return sourceSheet("chartOfAccounts", "Chart of Accounts", [
    ["Account ID", "Account Name", "Account Type", "Parent Account", "GST Applicable"],
    ...accounts.map((account) => [
      pick(account, ["account_id", "accountId", "id"]),
      pick(account, ["account_name", "accountName", "name"]),
      pick(account, ["account_type", "accountType", "type"]),
      pick(account, ["parent_account_name", "parentAccountName", "parent_account"]),
      pick(account, ["tax_name", "taxName", "gstApplicable"]) ? "Yes" : "No",
    ]),
  ]);
}

function contactsSheet(kind, title, contacts = [], vendor = false) {
  return sourceSheet(kind, title, [
    vendor
      ? ["Vendor Name", "GSTIN", "PAN", "State", "MSME", "TDS Section"]
      : ["Customer Name", "GSTIN", "PAN", "State", "Credit Limit"],
    ...contacts.map((contact) => [
      pick(contact, ["contact_name", "customer_name", "vendor_name", "name"]),
      pick(contact, ["gst_no", "gstin", "tax_reg_no"]),
      pick(contact, ["pan_no", "pan"]),
      pick(contact, ["place_of_contact", "state", "billing_address_state"]),
      vendor
        ? pick(contact, ["msme_type", "msme", "is_msme_registered"])
        : pick(contact, ["credit_limit"]),
      vendor ? pick(contact, ["tds_tax_name", "tds_section"]) : "",
    ]),
  ]);
}

function splitContacts(contacts = []) {
  const customers = [];
  const vendors = [];
  for (const contact of contacts) {
    const type = normalizeKey(pick(contact, ["contact_type", "type"]));
    if (type.includes("vendor")) vendors.push(contact);
    else if (type.includes("customer")) customers.push(contact);
    else {
      customers.push(contact);
      vendors.push(contact);
    }
  }
  return { customers, vendors };
}

function salesRegisterSheet(invoices = []) {
  return sourceSheet("salesRegister", "Sales Register", [
    [
      "Invoice Date",
      "Invoice No",
      "Customer Name",
      "GSTIN",
      "Place of Supply",
      "Taxable Value",
      "CGST",
      "SGST",
      "IGST",
      "Total GST",
      "Invoice Total",
      "Status",
    ],
    ...invoices.map((invoice) => {
      const taxable = amount(pick(invoice, ["sub_total", "subtotal", "taxable_value"]));
      const totalTax = amount(pick(invoice, ["tax_total", "taxTotal", "total_tax"]));
      return [
        pick(invoice, ["date", "invoice_date"]),
        pick(invoice, ["invoice_number", "number"]),
        pick(invoice, ["customer_name", "customerName"]),
        pick(invoice, ["gst_no", "gstin", "tax_reg_no"]),
        pick(invoice, ["place_of_supply", "placeOfSupply"]),
        taxable || amount(pick(invoice, ["total"])) - totalTax,
        pick(invoice, ["cgst", "cgst_amount"]),
        pick(invoice, ["sgst", "sgst_amount"]),
        pick(invoice, ["igst", "igst_amount"]),
        totalTax,
        amount(pick(invoice, ["total", "invoice_total"])),
        pick(invoice, ["status"]),
      ];
    }),
  ]);
}

function purchaseRegisterSheet(bills = []) {
  return sourceSheet("purchaseRegister", "Purchase Register", [
    [
      "Bill Date",
      "Bill No",
      "Vendor Name",
      "GSTIN",
      "Taxable Value",
      "CGST",
      "SGST",
      "IGST",
      "Total GST",
      "Bill Total",
      "ITC Eligible",
      "TDS Section",
    ],
    ...bills.map((bill) => {
      const totalTax = amount(pick(bill, ["tax_total", "taxTotal", "total_tax"]));
      return [
        pick(bill, ["date", "bill_date"]),
        pick(bill, ["bill_number", "bill_no", "number"]),
        pick(bill, ["vendor_name", "vendorName"]),
        pick(bill, ["gst_no", "gstin", "tax_reg_no"]),
        amount(pick(bill, ["sub_total", "subtotal", "taxable_value"])) ||
          amount(pick(bill, ["total"])) - totalTax,
        pick(bill, ["cgst", "cgst_amount"]),
        pick(bill, ["sgst", "sgst_amount"]),
        pick(bill, ["igst", "igst_amount"]),
        totalTax,
        amount(pick(bill, ["total", "bill_total"])),
        pick(bill, ["itc_eligibility", "itcEligible"]) || "Yes",
        pick(bill, ["tds_tax_name", "tds_section"]),
      ];
    }),
  ]);
}

function journalRegisterSheet(journals = []) {
  const rows = [];
  for (const journal of journals) {
    const lines = Array.isArray(journal.line_items) ? journal.line_items : [];
    if (!lines.length) {
      rows.push([
        pick(journal, ["date", "journal_date"]),
        pick(journal, ["journal_number", "journal_no", "entry_number"]),
        pick(journal, ["account_name"]),
        amount(pick(journal, ["debit"])),
        amount(pick(journal, ["credit"])),
        pick(journal, ["notes", "description", "narration"]),
        pick(journal, ["created_by_name", "created_by"]),
      ]);
      continue;
    }
    for (const line of lines) {
      rows.push([
        pick(journal, ["date", "journal_date"]),
        pick(journal, ["journal_number", "journal_no", "entry_number"]),
        pick(line, ["account_name", "accountName"]),
        amount(pick(line, ["debit"])),
        amount(pick(line, ["credit"])),
        pick(journal, ["notes", "description", "narration"]),
        pick(journal, ["created_by_name", "created_by"]),
      ]);
    }
  }
  return sourceSheet("journalRegister", "Journal Register", [
    ["Date", "Journal No", "Account Name", "Debit", "Credit", "Narration", "Created By"],
    ...rows,
  ]);
}

function transactionRows({ invoices = [], bills = [], journals = [] } = {}) {
  const rows = [];
  for (const invoice of invoices) {
    rows.push({
      date: pick(invoice, ["date", "invoice_date"]),
      voucherNo: pick(invoice, ["invoice_number", "number"]),
      voucherType: "Sales",
      accountName: "Sales",
      partyName: pick(invoice, ["customer_name"]),
      debit: 0,
      credit: amount(pick(invoice, ["total"])),
      narration: pick(invoice, ["notes", "description"]),
    });
  }
  for (const bill of bills) {
    rows.push({
      date: pick(bill, ["date", "bill_date"]),
      voucherNo: pick(bill, ["bill_number", "bill_no", "number"]),
      voucherType: "Purchase",
      accountName: "Purchase",
      partyName: pick(bill, ["vendor_name"]),
      debit: amount(pick(bill, ["total"])),
      credit: 0,
      narration: pick(bill, ["notes", "description"]),
    });
  }
  for (const journal of journals) {
    const lines = Array.isArray(journal.line_items) ? journal.line_items : [];
    for (const line of lines) {
      rows.push({
        date: pick(journal, ["date", "journal_date"]),
        voucherNo: pick(journal, ["journal_number", "journal_no", "entry_number"]),
        voucherType: "Journal",
        accountName: pick(line, ["account_name"]),
        partyName: "",
        debit: amount(pick(line, ["debit"])),
        credit: amount(pick(line, ["credit"])),
        narration: pick(journal, ["notes", "description", "narration"]),
      });
    }
  }
  return rows;
}

function generalLedgerSheet(rows = []) {
  return sourceSheet("generalLedger", "General Ledger", [
    ["Date", "Voucher No", "Voucher Type", "Account Name", "Party Name", "Debit", "Credit", "Narration"],
    ...rows.map((row) => [
      row.date,
      row.voucherNo,
      row.voucherType,
      row.accountName,
      row.partyName,
      row.debit,
      row.credit,
      row.narration,
    ]),
  ]);
}

function dayBookSheet(rows = []) {
  return sourceSheet("dayBook", "Day Book", [
    ["Date", "Voucher No", "Voucher Type", "Account Name", "Party Name", "Debit", "Credit", "Narration", "Created Time"],
    ...rows.map((row) => [
      row.date,
      row.voucherNo,
      row.voucherType,
      row.accountName,
      row.partyName,
      row.debit,
      row.credit,
      row.narration,
      "",
    ]),
  ]);
}

function trialBalanceSheet(rows = []) {
  const byAccount = new Map();
  for (const row of rows) {
    const accountName = normalizeText(row.accountName);
    if (!accountName) continue;
    const current = byAccount.get(accountName) || { debit: 0, credit: 0 };
    current.debit += amount(row.debit);
    current.credit += amount(row.credit);
    byAccount.set(accountName, current);
  }
  return sourceSheet("trialBalance", "Trial Balance", [
    ["Account Name", "Opening Debit", "Opening Credit", "Period Debit", "Period Credit", "Closing Debit", "Closing Credit"],
    ...Array.from(byAccount.entries()).map(([accountName, totals]) => {
      const net = totals.debit - totals.credit;
      return [
        accountName,
        0,
        0,
        totals.debit,
        totals.credit,
        net > 0 ? net : 0,
        net < 0 ? Math.abs(net) : 0,
      ];
    }),
  ]);
}

function ledgerTransactionValue(transaction = {}, keys = []) {
  return pick(transaction, keys);
}

function bankLedgerSheet(transactions = [], accountName = "Bank Account") {
  return sourceSheet("bankLedger", "Bank Ledger", [
    ["Date", "Voucher No", "Bank Account", "Party Name", "Deposit", "Withdrawal", "Reconciled", "Instrument Date", "Instrument No", "Narration"],
    ...transactions.map((transaction) => [
      ledgerTransactionValue(transaction, ["date", "transaction_date"]),
      ledgerTransactionValue(transaction, ["transaction_number", "reference_number", "payment_number", "number"]),
      ledgerTransactionValue(transaction, ["account_name"]) || accountName,
      ledgerTransactionValue(transaction, ["payee", "customer_name", "vendor_name", "contact_name"]),
      amount(ledgerTransactionValue(transaction, ["deposit", "credit", "amount_in"])),
      amount(ledgerTransactionValue(transaction, ["withdrawal", "debit", "amount_out"])),
      ledgerTransactionValue(transaction, ["is_reconciled", "reconciled"]) ? "Yes" : "No",
      ledgerTransactionValue(transaction, ["instrument_date", "cheque_date"]),
      ledgerTransactionValue(transaction, ["instrument_number", "cheque_number", "reference_number"]),
      ledgerTransactionValue(transaction, ["description", "notes", "narration"]),
    ]),
  ]);
}

function cashBookSheet(transactions = []) {
  let balance = 0;
  return sourceSheet("cashBook", "Cash Book", [
    ["Date", "Voucher No", "Account Name", "Receipt", "Payment", "Running Balance", "Narration"],
    ...transactions.map((transaction) => {
      const receipt = amount(ledgerTransactionValue(transaction, ["deposit", "credit", "amount_in"]));
      const payment = amount(ledgerTransactionValue(transaction, ["withdrawal", "debit", "amount_out"]));
      balance += receipt - payment;
      return [
        ledgerTransactionValue(transaction, ["date", "transaction_date"]),
        ledgerTransactionValue(transaction, ["transaction_number", "reference_number", "payment_number", "number"]),
        ledgerTransactionValue(transaction, ["account_name"]) || "Cash",
        receipt,
        payment,
        balance,
        ledgerTransactionValue(transaction, ["description", "notes", "narration"]),
      ];
    }),
  ]);
}

function fixedAssetsSheet(assets = []) {
  return sourceSheet("fixedAssetRegister", "Fixed Asset Register", [
    ["Asset ID", "Asset Name", "Purchase Date", "Cost", "Depreciation Rate", "Accumulated Depreciation", "WDV", "Capitalized"],
    ...assets.map((asset) => [
      pick(asset, ["asset_id", "fixed_asset_id", "id"]),
      pick(asset, ["asset_name", "name", "description"]),
      pick(asset, ["purchase_date", "date"]),
      amount(pick(asset, ["cost", "purchase_cost", "original_cost"])),
      pick(asset, ["depreciation_rate", "rate"]),
      amount(pick(asset, ["accumulated_depreciation"])),
      amount(pick(asset, ["written_down_value", "wdv", "book_value"])),
      pick(asset, ["status"]) === "active" ? "Yes" : "",
    ]),
  ]);
}

function emptyGstReportsSheet() {
  return sourceSheet("gstReports", "GST Reports", [
    ["Period", "Return Type", "Taxable Value", "IGST", "CGST", "SGST", "Total Tax", "Books Tax", "Return Tax", "Difference"],
  ]);
}

function emptyTdsReportsSheet() {
  return sourceSheet("tdsReports", "TDS Reports", [
    ["Date", "Voucher No", "Party Name", "Section", "Expense Amount", "TDS Deductible", "TDS Deducted", "Challan Paid", "Due Date"],
  ]);
}

async function listOrganizations() {
  const json = await zohoFetch("/organizations");
  return firstArray(json, ["organizations"]);
}

async function resolveOrganization(organizationId = "auto") {
  const organizations = await listOrganizations();
  if (!organizations.length) {
    throw new Error("Zoho Books did not return any organizations for this account.");
  }

  const requested = normalizeText(organizationId);
  if (requested && requested !== "auto") {
    const match = organizations.find(
      (org) => String(org.organization_id || org.organizationId || org.id) === requested,
    );
    if (!match) throw new Error(`Zoho organization not found: ${requested}`);
    return match;
  }

  const active = organizations.filter((org) => org.is_org_active !== false);
  const defaultOrg = active.find((org) => org.is_default_org);
  if (defaultOrg) return defaultOrg;
  if (active.length === 1) return active[0];

  const choices = active
    .slice(0, 8)
    .map((org) => `${org.name || org.organization_name} (${org.organization_id || org.id})`)
    .join(", ");
  throw new Error(
    `Multiple Zoho Books organizations are available. Ask the user to specify one organization ID. Choices: ${choices}`,
  );
}

async function fetchRegisterTransactionsForAccounts(accounts = [], organizationId, period, diagnostics) {
  const selected = accounts.filter((account) => {
    const type = normalizeKey(pick(account, ["account_type", "type"]));
    return type.includes("bank") || type.includes("cash");
  });
  const transactions = [];
  for (const account of selected.slice(0, 10)) {
    const accountId = pick(account, ["account_id", "id"]);
    if (!accountId) continue;
    const accountName = pick(account, ["account_name", "name"]);
    const rows = await safeFetchAllPages(
      `/registers/${encodeURIComponent(accountId)}/transactions`,
      {
        query: {
          organization_id: organizationId,
          ...dateInPeriodQuery(period),
        },
        resultKeys: ["transactions"],
      },
      diagnostics,
      `Register transactions for ${accountName || accountId}`,
    );
    for (const row of rows) transactions.push({ ...row, account_name: row.account_name || accountName });
  }
  return transactions;
}

async function fetchAuditSourceSnapshot(command = {}) {
  const period = command.period || {};
  if (!period.startDate || !period.endDate) {
    throw new Error("Zoho Books audit source fetch requires startDate and endDate.");
  }

  const organization = await resolveOrganization(command.organizationId || "auto");
  const organizationId = organization.organization_id || organization.organizationId || organization.id;
  const diagnostics = [];
  const periodQuery = dateInPeriodQuery(period);

  const [accounts, contacts, invoices, bills, journals, fixedAssets] = await Promise.all([
    safeFetchAllPages(
      "/chartofaccounts",
      { query: { organization_id: organizationId }, resultKeys: ["chartofaccounts", "accounts"] },
      diagnostics,
      "Chart of accounts",
    ),
    safeFetchAllPages(
      "/contacts",
      { query: { organization_id: organizationId }, resultKeys: ["contacts"] },
      diagnostics,
      "Contacts",
    ),
    safeFetchAllPages(
      "/invoices",
      { query: { organization_id: organizationId, ...periodQuery }, resultKeys: ["invoices"] },
      diagnostics,
      "Invoices",
    ),
    safeFetchAllPages(
      "/bills",
      { query: { organization_id: organizationId, ...periodQuery }, resultKeys: ["bills"] },
      diagnostics,
      "Bills",
    ),
    safeFetchAllPages(
      "/journals",
      { query: { organization_id: organizationId, ...periodQuery }, resultKeys: ["journals"] },
      diagnostics,
      "Journals",
    ),
    safeFetchAllPages(
      "/fixedassets",
      { query: { organization_id: organizationId }, resultKeys: ["fixed_assets", "fixedassets"] },
      diagnostics,
      "Fixed assets",
    ),
  ]);

  const registerTransactions = await fetchRegisterTransactionsForAccounts(
    accounts,
    organizationId,
    period,
    diagnostics,
  );
  const cashTransactions = registerTransactions.filter((transaction) =>
    normalizeKey(transaction.account_name).includes("cash"),
  );
  const bankTransactions = registerTransactions.filter(
    (transaction) => !normalizeKey(transaction.account_name).includes("cash"),
  );
  const rows = transactionRows({ invoices, bills, journals });
  const { customers, vendors } = splitContacts(contacts);

  const token = await readStoredToken();
  return {
    id: `zoho-books-${organizationId}-${Date.now()}`,
    provider: ZOHO_BOOKS_PROVIDER,
    workflowKind: ZOHO_BOOKS_AUDIT,
    organization: {
      id: String(organizationId || ""),
      name: organization.name || organization.organization_name || "",
      dataCenter: token?.dataCenter || "",
    },
    period,
    fetchedAt: new Date().toISOString(),
    diagnostics,
    sheets: [
      trialBalanceSheet(rows),
      generalLedgerSheet(rows),
      dayBookSheet(rows),
      salesRegisterSheet(invoices),
      purchaseRegisterSheet(bills),
      journalRegisterSheet(journals),
      bankLedgerSheet(bankTransactions),
      cashBookSheet(cashTransactions),
      contactsSheet("customerList", "Customer List", customers, false),
      contactsSheet("vendorList", "Vendor List", vendors, true),
      fixedAssetsSheet(fixedAssets),
      emptyGstReportsSheet(),
      emptyTdsReportsSheet(),
      chartOfAccountsSheet(accounts),
    ],
  };
}

async function runZohoBooksCommand(command = {}) {
  const name = normalizeText(command.name || command.tool || command.type);
  if (name !== "fetch_audit_source_snapshot") {
    throw new Error(`Unsupported Zoho Books source provider command: ${name || "unknown"}`);
  }
  return fetchAuditSourceSnapshot(command);
}

async function runZohoBooksSourceProviderCommands(commands = []) {
  const results = [];
  const snapshots = [];
  for (const command of commands) {
    try {
      const snapshot = await runZohoBooksCommand(command);
      snapshots.push(snapshot);
      results.push({ ok: true, command, snapshot });
    } catch (error) {
      results.push({
        ok: false,
        command,
        error: error?.message || String(error),
      });
      return {
        ok: false,
        provider: ZOHO_BOOKS_PROVIDER,
        summary: `Zoho Books source provider failed: ${error?.message || String(error)}`,
        error: error?.message || String(error),
        results,
        snapshots,
      };
    }
  }

  return {
    ok: true,
    provider: ZOHO_BOOKS_PROVIDER,
    summary: `Fetched ${snapshots.length} Zoho Books audit snapshot${snapshots.length === 1 ? "" : "s"}.`,
    results,
    snapshots,
  };
}

async function connectZohoBooks() {
  try {
    if (!interactiveAuthPromise) {
      interactiveAuthPromise = getAccessToken({ interactive: true }).finally(() => {
        interactiveAuthPromise = null;
      });
    }
    await interactiveAuthPromise;
    return getZohoBooksAuthStatus();
  } catch (error) {
    return {
      ok: false,
      provider: ZOHO_BOOKS_PROVIDER,
      authenticated: false,
      authStatus: "unauthenticated",
      error: error?.message || String(error),
    };
  }
}

async function getZohoBooksAuthStatus() {
  if (!(await isZohoConfigured())) {
    return {
      ok: true,
      provider: ZOHO_BOOKS_PROVIDER,
      authenticated: false,
      authStatus: "unconfigured",
      configMissing: true,
      error: zohoSetupError().message,
    };
  }

  try {
    await getAccessToken({ interactive: false });
    return {
      ok: true,
      provider: ZOHO_BOOKS_PROVIDER,
      authenticated: true,
      authStatus: "authenticated",
    };
  } catch (error) {
    return {
      ok: true,
      provider: ZOHO_BOOKS_PROVIDER,
      authenticated: false,
      authStatus: "unauthenticated",
      error: error?.message || String(error),
    };
  }
}

async function runSourceProviderCommands(provider, commands = []) {
  if (normalizeText(provider) !== ZOHO_BOOKS_PROVIDER) {
    return {
      ok: false,
      provider,
      summary: `Unsupported source provider: ${provider || "unknown"}.`,
      error: `Unsupported source provider: ${provider || "unknown"}.`,
      results: [],
      snapshots: [],
    };
  }
  return runZohoBooksSourceProviderCommands(commands);
}

export const zohoBooksSourceProviderRuntime = {
  connectZohoBooks,
  getZohoBooksAuthStatus,
  runSourceProviderCommands,
};

export {
  fetchAuditSourceSnapshot,
  getZohoBooksAuthStatus,
  runSourceProviderCommands,
};
