#!/usr/bin/env node

import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadCloudEnv } from "@webgpt/browserbase-host/env";
import { runCloudWebGpt } from "@webgpt/browserbase-host/runCloud";
import { readCloudServiceConfig } from "./config.js";
import { createCloudRunHttpServer } from "./http.js";
import { createCloudRunQueue } from "./queue.js";
import { CloudRunStore } from "./store.js";
import { createRoutineScheduler } from "./routineScheduler.js";
import { createNotificationDispatcher } from "./notificationDispatcher.js";

export function createCloudService({ config, runner = runCloudWebGpt, logStream } = {}) {
  const store = new CloudRunStore({ dbPath: config.dbPath });
  const recovered = store.recoverInterruptedRuns();
  const queue = createCloudRunQueue({
    store,
    runner,
    config,
    logStream,
  });
  const routineScheduler = createRoutineScheduler({
    store,
    queue,
    intervalMs: config.routineSchedulerIntervalMs,
    logStream,
  });
  const notificationDispatcher = createNotificationDispatcher({
    store,
    config,
    intervalMs: config.notificationIntervalMs,
    logStream,
  });
  const server = createCloudRunHttpServer({ store, queue, config });

  return {
    config,
    notificationDispatcher,
    queue,
    recovered,
    routineScheduler,
    server,
    store,
    start() {
      queue.start();
      routineScheduler.start();
      notificationDispatcher.start();
      return new Promise((resolve) => {
        server.listen(config.port, config.host, () => resolve(server));
      });
    },
    async close() {
      notificationDispatcher.close();
      routineScheduler.close();
      queue.close();
      await new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }).catch((error) => {
        if (error?.code !== "ERR_SERVER_NOT_RUNNING") throw error;
      });
      store.close();
    },
  };
}

async function main() {
  loadCloudEnv();
  const config = readCloudServiceConfig();
  const service = createCloudService({ config });

  await service.start();

  console.log(
    `WebGPT cloud service listening on http://${config.host}:${config.port}`,
  );
  if (service.recovered > 0) {
    console.log(`Recovered ${service.recovered} interrupted cloud run(s).`);
  }
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  main().catch((error) => {
    console.error(error?.message || String(error));
    process.exit(1);
  });
}
