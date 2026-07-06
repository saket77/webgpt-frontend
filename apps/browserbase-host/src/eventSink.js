import fs from "node:fs/promises";
import path from "node:path";
import { defaultLogsDir } from "./paths.js";

function safeTimestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

export async function createCloudEventSink({
  logsDir = "",
  runLabel = "run",
  stream = process.stdout,
  onEvent,
} = {}) {
  const dir = path.resolve(logsDir || defaultLogsDir);
  await fs.mkdir(dir, { recursive: true });

  const eventLogPath = path.join(
    dir,
    `${safeTimestamp()}-${runLabel.replace(/[^a-z0-9_-]+/gi, "-")}.jsonl`,
  );

  async function addEvent(tabId, event) {
    const enriched = {
      timestamp: new Date().toISOString(),
      tabId,
      ...event,
    };

    await fs.appendFile(eventLogPath, `${JSON.stringify(enriched)}\n`);

    const label = enriched.kind || "event";
    const message = enriched.message || enriched.summary || enriched.error || "";
    const line = message ? `[cloud:${label}] ${message}` : `[cloud:${label}]`;
    stream.write(`${line}\n`);

    if (typeof onEvent === "function") {
      await onEvent(enriched);
    }

    return enriched;
  }

  return {
    eventLogPath,
    eventSink: { addEvent },
  };
}
