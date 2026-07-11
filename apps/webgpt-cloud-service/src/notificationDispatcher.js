function truncateJson(value, maxLength = 4000) {
  const text = JSON.stringify(value ?? null, null, 2);
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength)}\n...`;
}

function resultRows(finalResult) {
  return Array.isArray(finalResult?.rows) ? finalResult.rows : [];
}

function formatRowsText(rows) {
  if (!rows.length) return "";

  return rows
    .map((row, index) =>
      [
        `${index + 1}. ${row.name || "IPO"}`,
        row.subscription ? `Subscription: ${row.subscription}` : "",
        row.gmp || row.gmpPercent ? `GMP: ${[row.gmp, row.gmpPercent].filter(Boolean).join(" ")}` : "",
        row.price ? `Price: ${row.price}` : "",
        row.open ? `Open: ${row.open}` : "",
        row.close ? `Close: ${row.close}` : "",
        row.updated ? `Updated: ${row.updated}` : "",
        row.detailUrl ? `Detail: ${row.detailUrl}` : "",
      ]
        .filter(Boolean)
        .join("; "),
    )
    .join("\n");
}

function formatRowsHtml(rows) {
  if (!rows.length) return "";

  const headers = ["Name", "Subscription", "GMP", "Price", "Open", "Close", "Updated"];
  const head = headers.map((header) => `<th>${escapeHtml(header)}</th>`).join("");
  const body = rows
    .map((row) => {
      const gmp = [row.gmp, row.gmpPercent].filter(Boolean).join(" ");
      const cells = [
        row.detailUrl
          ? `<a href="${escapeHtml(row.detailUrl)}">${escapeHtml(row.name || "IPO")}</a>`
          : escapeHtml(row.name || "IPO"),
        escapeHtml(row.subscription || ""),
        escapeHtml(gmp),
        escapeHtml(row.price || ""),
        escapeHtml(row.open || ""),
        escapeHtml(row.close || ""),
        escapeHtml(row.updated || ""),
      ];
      return `<tr>${cells.map((cell) => `<td>${cell}</td>`).join("")}</tr>`;
    })
    .join("");

  return `<table border="1" cellpadding="6" cellspacing="0"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

function buildEmail({ notification, routine, cloudRun }) {
  const status = cloudRun.status;
  const subject = `[WebGPT] ${routine?.name || "Routine"} ${status}`;
  const rows = resultRows(cloudRun.finalResult);
  const rowsText = formatRowsText(rows);
  const rowsHtml = formatRowsHtml(rows);
  const lines = [
    `Routine: ${routine?.name || notification.routineId}`,
    `Status: ${status}`,
    `CloudRun: ${cloudRun.id}`,
    "",
  ];

  if (cloudRun.summary) {
    lines.push("Summary:", cloudRun.summary, "");
  }

  if (cloudRun.error?.message) {
    lines.push("Error:", cloudRun.error.message, "");
  }

  if (rowsText) {
    lines.push("Rows:", rowsText, "");
  }

  if (cloudRun.finalResult) {
    lines.push("Final result:", truncateJson(cloudRun.finalResult), "");
  }

  if (cloudRun.liveViewUrl) {
    lines.push(`Live View: ${cloudRun.liveViewUrl}`);
  }
  if (cloudRun.sessionUrl) {
    lines.push(`Session: ${cloudRun.sessionUrl}`);
  }

  const bodyText = lines.join("\n");
  const html = `
    <h2>WebGPT routine ${status}</h2>
    <p><strong>Routine:</strong> ${routine?.name || notification.routineId}</p>
    <p><strong>Status:</strong> ${status}</p>
    <p><strong>CloudRun:</strong> ${cloudRun.id}</p>
    ${
      cloudRun.summary
        ? `<h3>Summary</h3><p>${escapeHtml(cloudRun.summary).replace(/\n/g, "<br />")}</p>`
        : ""
    }
    ${
      cloudRun.error?.message
        ? `<h3>Error</h3><p>${escapeHtml(cloudRun.error.message)}</p>`
        : ""
    }
    ${rowsHtml ? `<h3>Rows</h3>${rowsHtml}` : ""}
    ${
      cloudRun.finalResult
        ? `<h3>Final result</h3><pre>${escapeHtml(truncateJson(cloudRun.finalResult))}</pre>`
        : ""
    }
    ${
      cloudRun.liveViewUrl
        ? `<p><strong>Live View:</strong> <a href="${escapeHtml(cloudRun.liveViewUrl)}">${escapeHtml(cloudRun.liveViewUrl)}</a></p>`
        : ""
    }
    ${
      cloudRun.sessionUrl
        ? `<p><strong>Session:</strong> <a href="${escapeHtml(cloudRun.sessionUrl)}">${escapeHtml(cloudRun.sessionUrl)}</a></p>`
        : ""
    }
  `;

  return {
    subject,
    bodyText,
    html,
  };
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function sanitizeHeader(value) {
  return String(value || "")
    .replace(/[\r\n]+/g, " ")
    .trim();
}

function encodeHeader(value) {
  const sanitized = sanitizeHeader(value);
  if (/^[\x20-\x7E]*$/.test(sanitized)) return sanitized;
  return `=?UTF-8?B?${Buffer.from(sanitized, "utf8").toString("base64")}?=`;
}

function normalizeBody(value) {
  return String(value || "").replace(/\r?\n/g, "\r\n");
}

function normalizeRecipients(to) {
  return (Array.isArray(to) ? to : [to]).map(sanitizeHeader).filter(Boolean);
}

function base64UrlEncode(value) {
  return Buffer.from(value, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function buildMimeMessage({ from, to, subject, bodyText, html }) {
  const recipients = normalizeRecipients(to);
  if (!from) throw new Error("WEBGPT_EMAIL_FROM or GMAIL_FROM is required for Gmail API email.");
  if (recipients.length === 0) throw new Error("At least one email recipient is required.");

  const boundary = `webgpt_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  return [
    `From: ${sanitizeHeader(from)}`,
    `To: ${recipients.join(", ")}`,
    `Subject: ${encodeHeader(subject)}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: 8bit",
    "",
    normalizeBody(bodyText),
    `--${boundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    "Content-Transfer-Encoding: 8bit",
    "",
    normalizeBody(html),
    `--${boundary}--`,
    "",
  ].join("\r\n");
}

async function fetchJsonWithTimeout({
  fetchImpl,
  url,
  timeoutMs,
  request,
  timeoutMessage,
}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs || 15000);

  try {
    const response = await fetchImpl(url, {
      ...request,
      signal: controller.signal,
    });
    const data = await response.json().catch(() => ({}));
    return { response, data };
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error(timeoutMessage || "Gmail API request timed out.");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function getGmailAccessToken({ config, fetchImpl }) {
  if (!config.gmailClientId || !config.gmailClientSecret || !config.gmailRefreshToken) {
    throw new Error("GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, and GMAIL_REFRESH_TOKEN are required for Gmail API email.");
  }

  const body = new URLSearchParams({
    client_id: config.gmailClientId,
    client_secret: config.gmailClientSecret,
    refresh_token: config.gmailRefreshToken,
    grant_type: "refresh_token",
  });
  const { response, data } = await fetchJsonWithTimeout({
    fetchImpl,
    url: config.gmailTokenUrl,
    timeoutMs: config.gmailTimeoutMs,
    timeoutMessage: "Gmail OAuth token request timed out.",
    request: {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
    },
  });

  if (!response.ok) {
    throw new Error(data.error_description || data.error || `Gmail OAuth token request failed with HTTP ${response.status}.`);
  }
  if (!data.access_token) {
    throw new Error("Gmail OAuth token response did not include access_token.");
  }

  return data.access_token;
}

async function sendViaGmailApi({
  to,
  subject,
  bodyText,
  html,
  config,
  fetchImpl = globalThis.fetch,
}) {
  if (typeof fetchImpl !== "function") {
    throw new Error("No fetch implementation available for Gmail API email.");
  }

  const accessToken = await getGmailAccessToken({ config, fetchImpl });
  const mimeMessage = buildMimeMessage({
    from: config.emailFrom,
    to,
    subject,
    bodyText,
    html,
  });

  const { response, data } = await fetchJsonWithTimeout({
    fetchImpl,
    url: config.gmailSendUrl,
    timeoutMs: config.gmailTimeoutMs,
    timeoutMessage: "Gmail send request timed out.",
    request: {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        raw: base64UrlEncode(mimeMessage),
      }),
    },
  });

  if (!response.ok) {
    const errorMessage =
      data.error?.message ||
      data.error_description ||
      data.error ||
      `Gmail send request failed with HTTP ${response.status}.`;
    throw new Error(errorMessage);
  }

  return {
    provider: "gmail_api",
    providerId: data.id || "",
  };
}

export function createNotificationDispatcher({
  store,
  config,
  intervalMs = 15000,
  logStream = process.stderr,
  sendEmail,
  fetchImpl = globalThis.fetch,
} = {}) {
  if (!store) throw new Error("createNotificationDispatcher requires store.");

  let timer = null;
  let active = false;

  async function deliver(notification) {
    const cloudRun = store.getRunForApi(notification.cloudRunId);
    if (!cloudRun) {
      const skipped = store.markNotificationSkipped(
        notification.id,
        "CloudRun not found for notification.",
      );
      return skipped;
    }

    if (cloudRun.status !== "completed" && cloudRun.status !== "failed") {
      return notification;
    }

    const routine = store.getRoutine(notification.routineId);
    const email = buildEmail({ notification, routine, cloudRun });

    try {
      if (sendEmail) {
        await sendEmail({
          to: notification.to,
          subject: email.subject,
          bodyText: email.bodyText,
          html: email.html,
          cloudRun,
          notification,
          routine,
        });
      } else if (config.emailProvider === "console") {
        logStream.write(
          `[routine-email] to=${notification.to.join(",")} subject=${email.subject}\n${email.bodyText}\n`,
        );
      } else if (config.emailProvider === "gmail_api") {
        await sendViaGmailApi({
          to: notification.to,
          subject: email.subject,
          bodyText: email.bodyText,
          html: email.html,
          config,
          fetchImpl,
        });
      } else {
        throw new Error(`Unsupported email provider: ${String(config.emailProvider)}.`);
      }

      const sent = store.markNotificationSent(notification.id, email);
      store.recordProgressEvent(cloudRun.id, {
        kind: "notification_sent",
        message: "Email notification sent.",
        event: {
          notificationId: notification.id,
          to: notification.to,
        },
      });
      return sent;
    } catch (error) {
      const failed = store.markNotificationFailed(notification.id, error);
      store.recordProgressEvent(cloudRun.id, {
        kind: "notification_failed",
        message: error?.message || "Email notification failed.",
        event: {
          notificationId: notification.id,
        },
      });
      return failed;
    }
  }

  async function tick() {
    if (active) return [];
    active = true;
    const handled = [];

    try {
      for (const notification of store.listPendingNotifications()) {
        handled.push(await deliver(notification));
      }
    } finally {
      active = false;
    }

    return handled;
  }

  return {
    async tick() {
      return tick();
    },
    start() {
      if (timer) return;
      timer = setInterval(() => {
        void tick();
      }, intervalMs);
      timer.unref?.();
      void tick();
    },
    close() {
      if (timer) clearInterval(timer);
      timer = null;
    },
  };
}
