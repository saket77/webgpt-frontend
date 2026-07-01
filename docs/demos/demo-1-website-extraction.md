# Demo 1: WebGPT Routines - Philly Property Workflow

This Short shows WebGPT running a Philadelphia property lookup and saving the successful path as a reusable routine.

## What It Shows

- WebGPT reads and acts on a normal city/property website through the browser runtime.
- A successful property lookup path can be saved as a routine.
- The same workflow can run again with a new property input.
- The final output is a completed property summary, not just a list of clicks.

## Why It Matters

Browser agents should not start from zero every time. Once WebGPT finds a reliable path through a real workflow, it can preserve that path and reuse it across new inputs.

This is the first public demo in the arc: WebGPT is not only a one-off browser agent. It is a runtime for repeatable browser work.

## Demo Message

Same workflow, new input, completed summaries.

## Repro Shape

1. Start from a Philadelphia property lookup workflow.
2. Let WebGPT complete the lookup once.
3. Save the successful path as a routine.
4. Run the routine again with a different property input.
5. Confirm the repeated run produces the expected property summary.
