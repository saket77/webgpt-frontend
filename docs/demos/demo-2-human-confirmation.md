# Demo 2: Human-Confirmed Form Filling

This demo shows WebGPT filling a form while keeping final user-sensitive actions behind explicit confirmation.

## What It Shows

- Planning normal `fill`, `click`, `press`, and `wait` actions
- Using adapter hints when a site adapter is active
- Pausing for human guidance or confirmation when the task reaches a sensitive boundary
- Resuming the same run after a human hint or success rejection

## Why It Matters

Useful browser agents need a visible recovery path. WebGPT treats human intervention as part of the run loop rather than an exception outside the system.

## Repro Checklist

1. Open a page with a small form.
2. Ask WebGPT to fill safe fields with known values.
3. Confirm it does not perform a sensitive final action unless requested.
4. Provide a hint or reject a premature completion and confirm the run resumes.

