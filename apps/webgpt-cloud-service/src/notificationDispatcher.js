import nodemailer from "nodemailer";

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

async function sendViaResend({ to, subject, bodyText, html, config }) {
  if (!config.resendApiKey || !config.emailFrom) {
    throw new Error("RESEND_API_KEY and WEBGPT_EMAIL_FROM or RESEND_FROM are required for Resend email.");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.resendTimeoutMs || 15000);
  let response;

  try {
    response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${config.resendApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: config.emailFrom,
        to,
        subject,
        text: bodyText,
        html,
      }),
    });
  } finally {
    clearTimeout(timeout);
  }

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.message || data.error || `Resend email failed with HTTP ${response.status}.`);
  }

  return {
    provider: "resend",
    providerId: data.id || "",
  };
}

async function sendViaSmtp({
  to,
  subject,
  bodyText,
  html,
  config,
  createTransport = nodemailer.createTransport,
}) {
  if (!config.smtpHost || !config.smtpUser || !config.smtpPass) {
    throw new Error("SMTP_HOST, SMTP_USER, and SMTP_PASS are required for SMTP email.");
  }

  const from = config.emailFrom || config.smtpUser;
  if (!from) {
    throw new Error("WEBGPT_EMAIL_FROM or SMTP_USER is required for SMTP email.");
  }

  const transport = createTransport({
    host: config.smtpHost,
    port: config.smtpPort || 465,
    secure: Boolean(config.smtpSecure),
    auth: {
      user: config.smtpUser,
      pass: config.smtpPass,
    },
  });

  const result = await transport.sendMail({
    from,
    to,
    subject,
    text: bodyText,
    html,
  });

  return {
    provider: "smtp",
    providerId: result?.messageId || "",
  };
}

export function createNotificationDispatcher({
  store,
  config,
  intervalMs = 15000,
  logStream = process.stderr,
  sendEmail,
  createSmtpTransport,
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
      } else if (config.emailProvider === "resend") {
        await sendViaResend({
          to: notification.to,
          subject: email.subject,
          bodyText: email.bodyText,
          html: email.html,
          config,
        });
      } else if (config.emailProvider === "smtp") {
        await sendViaSmtp({
          to: notification.to,
          subject: email.subject,
          bodyText: email.bodyText,
          html: email.html,
          config,
          createTransport: createSmtpTransport,
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
