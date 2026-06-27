# Demo 1: Website Extraction

This demo shows WebGPT reading a normal website through the browser DOM runtime and returning structured facts without requiring a site-specific integration.

## What It Shows

- Extracting browser state from the active tab
- Ranking visible controls, headings, and page text for the planner
- Using `extract_state` and `extract` before summarizing facts
- Keeping the backend focused on planning while the extension owns page observation

## Why It Matters

This is the baseline WebGPT loop. Before runtimes, connectors, replay, or specialized adapters matter, WebGPT needs to prove that a planner can understand an ordinary web page from compact structured state.

## Repro Checklist

1. Load the extension.
2. Open a normal public website.
3. Ask WebGPT to extract a bounded set of visible facts.
4. Confirm the run summary cites information actually present in the page state.

