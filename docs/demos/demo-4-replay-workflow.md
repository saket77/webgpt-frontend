# Demo 4: Replay Across Inputs

This demo shows WebGPT turning a successful confirmed run into a replayable routine.

## What It Shows

- Saving successful run and replay artifacts
- Templating user-provided values into replay input schema
- Running `run_replay_batch` before returning to normal planning
- Handling replay navigation and runtime replay batches through the same controller loop

## Why It Matters

Replay is the bridge between one-off agent work and repeatable workflows. A successful run should become a reusable artifact that can be applied to new inputs with less planning overhead.

## Repro Checklist

1. Complete a browser or runtime workflow successfully.
2. Confirm success and save replay artifacts.
3. Start a template/replay run with a new input value.
4. Confirm replay performs the saved steps and hands control back to the planner when fresh state is needed.

