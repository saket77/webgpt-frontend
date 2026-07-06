# Demo 7: WebGPT Runs In A Browserbase Cloud Browser

This Short shows the same WebGPT runtime that powers the Chrome extension running instead inside a Browserbase cloud browser, driven from the command line.

WebGPT started as a Chrome extension. This demo shows the frontend refactored into shared runtime packages with swappable hosts, so the browser becomes an implementation detail while the planner loop stays the same.

## What It Shows

- Running an agent task against a real website without loading the Chrome extension.
- Creating a Browserbase session and connecting to the cloud browser with Playwright over CDP.
- Injecting the same `@webgpt/page-runtime` scripts the extension uses into the cloud browser.
- Calling the same planner backend through `@webgpt/planner-http-adapter` and executing commands through `@webgpt/controller-core`.
- Watching the run move in the Browserbase Live View while state extraction, actions, and site adapters behave as they do in the extension.
- Using the CLI as a browser-agent bench: a real run produces a JSONL event log and artifacts an agent like Codex can inspect to improve the runtime.

## Why It Matters

Testing a browser-extension agent by hand is a slow feedback loop: reload the extension, open a tab, open the sidepanel, run the task, read the logs. Splitting the frontend into a host-agnostic runtime plus separate extension and cloud hosts turns that into a command you can run and script.

Browserbase here is the cloud browser infrastructure, not the agent. WebGPT still owns state extraction, action execution, the planner loop, replay, site adapters, connector tools, and the backend contract. Because the same runtime now runs headlessly, real-website integration benches become possible, which is where most browser-agent failures actually show up.

## Demo Message

WebGPT is a browser-agnostic runtime: the same agent can run in a Chrome extension or a Browserbase cloud browser, so real-website testing can run from the command line.

## Repro Shape

1. Set `BROWSERBASE_API_KEY` and `BROWSERBASE_PROJECT_ID`.
2. Start a compatible planner backend, for example on `http://localhost:3000`.
3. Run `npm run cloud:run -- --eprocure --backend http://localhost:3000`, or pass a custom `--url` and `--goal`.
4. Open the printed Browserbase Live View URL to watch the cloud browser run the task.
5. Inspect the JSONL event log under `.webgpt-cloud-runs/` plus backend artifacts to review or improve the run.
