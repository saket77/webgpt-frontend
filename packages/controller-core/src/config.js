export let MAX_STEPS = 20;
export let POST_ACTION_STATE_SETTLE_MS = 1000;
export let POST_NAVIGATION_RESUME_SETTLE_MS = 1000;
export let MAX_EVENTS = 300;

export function configureControllerCoreConfig(config = {}) {
  if (Number.isFinite(config.MAX_STEPS)) {
    MAX_STEPS = Number(config.MAX_STEPS);
  }
  if (Number.isFinite(config.POST_ACTION_STATE_SETTLE_MS)) {
    POST_ACTION_STATE_SETTLE_MS = Number(config.POST_ACTION_STATE_SETTLE_MS);
  }
  if (Number.isFinite(config.POST_NAVIGATION_RESUME_SETTLE_MS)) {
    POST_NAVIGATION_RESUME_SETTLE_MS = Number(
      config.POST_NAVIGATION_RESUME_SETTLE_MS,
    );
  }
  if (Number.isFinite(config.MAX_EVENTS)) {
    MAX_EVENTS = Number(config.MAX_EVENTS);
  }
}
