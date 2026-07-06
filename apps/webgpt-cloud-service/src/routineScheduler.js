import { computeNextDailyRunAt } from "./schedule.js";

export function createRoutineScheduler({
  store,
  queue,
  intervalMs = 60000,
  now = () => new Date(),
  logStream = process.stderr,
} = {}) {
  if (!store) throw new Error("createRoutineScheduler requires store.");
  if (!queue) throw new Error("createRoutineScheduler requires queue.");

  let timer = null;
  let active = false;

  async function tick() {
    if (active) return [];
    active = true;
    const fired = [];

    try {
      const current = now();
      const dueRoutines = store.listDueRoutines(current.toISOString());

      for (const routine of dueRoutines) {
        try {
          const result = store.triggerRoutine(routine.id, {
            triggeredBy: "schedule",
            dueAt: routine.nextRunAt,
            createdAt: current.toISOString(),
          });

          if (result) {
            fired.push(result);
            queue.enqueue();
          }

          const nextRunAt = routine.schedule
            ? computeNextDailyRunAt(routine.schedule, {
                now: new Date(current.getTime() + 1000),
              })
            : null;
          store.setRoutineNextRunAt(routine.id, nextRunAt, {
            updatedAt: current.toISOString(),
          });
        } catch (error) {
          logStream.write(
            `[routine-scheduler] ${routine.id}: ${error?.message || String(error)}\n`,
          );
        }
      }
    } finally {
      active = false;
    }

    return fired;
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
