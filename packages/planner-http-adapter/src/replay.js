export function createReplayPreflight({ postCommandResult }) {
  return async function tryRunReplayPreflight({
    runId,
    artifactFileName = "",
  } = {}) {
    if (!runId) {
      return { skipped: true, command: null, run: null };
    }

    const result = await postCommandResult({
      runId,
      type: "replay_preflight_requested",
      artifactFileName,
    });

    const command = result.command || null;

    return {
      skipped: command?.replay?.status === "skipped",
      command,
      run: result.run || command?.run || null,
    };
  };
}
