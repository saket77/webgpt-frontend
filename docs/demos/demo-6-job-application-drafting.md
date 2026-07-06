# Demo 6: WebGPT Drafts Job Applications With Guardrails

This Short shows WebGPT reading an uploaded resume and drafting job applications across two different application surfaces, Ashby and Greenhouse, while keeping the sensitive actions blocked.

The idea is application drafting with brakes: speed up the repetitive fields, slow down the decisions that should stay human.

## What It Shows

- Reading a user-attached resume so field values are grounded in a real document instead of guessed.
- Drafting the repetitive parts of an Ashby application: text fields, dropdowns, work authorization, short answers.
- Doing the same on a Greenhouse application through a separate site adapter, with the same planner goal.
- Treating resume upload and final submit as protected actions, blocked deterministically at the runtime level rather than by prompt instruction.
- Stopping around the messy fields so a human can review before anything is submitted.

## Why It Matters

Most auto-apply tools optimize for volume and submit unreviewed applications. That produces worse outcomes for applicants and more spam for recruiters.

This demo shows a different default: the agent physically cannot click through the irreversible steps. The runtime enforces the boundary, so the repetitive work gets faster without handing the whole decision to a model. It also shows two site adapters (Ashby and Greenhouse) reaching the same planner loop, which is the connector model applied to a real personal workflow.

## Demo Message

WebGPT can read your documents and draft real job applications, while keeping upload and submit as human-controlled actions.

## Repro Shape

1. Attach a resume so the backend can parse its text into planner context.
2. Open an Ashby application and give WebGPT the goal of drafting it.
3. Let WebGPT fill text fields, dropdowns, work authorization, and short answers from the resume.
4. Confirm that resume upload and final submit are blocked and left to the human.
5. Repeat on a Greenhouse application to show the same goal working across a different application surface.
