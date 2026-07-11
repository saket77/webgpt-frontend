# Simple Backend Example

This is a tiny WebGPT-compatible backend for local testing. The extension host defaults to the hosted WebGPT planner; use this example when you want to inspect the contract locally or test frontend changes without a real planner.

It has two deterministic, LLM-free modes:

- the default mode returns the original hardcoded `run_actions` command
- `WEBGPT_SIMPLE_MODE=webmcp` serves a local WebMCP fixture and drives a discovery/ordered-batch/verification loop using route metadata from extracted state

It is intentionally small and dependency-free.

## Run

```bash
cd examples/simple-backend
npm start
```

The server listens on `http://127.0.0.1:8787` by default.

Point the extension backend URL at:

```text
http://127.0.0.1:8787
```

Or run the Browserbase host against it:

```bash
npm run cloud:run -- --url "https://example.com" --goal "Run the simple backend action." --backend http://127.0.0.1:8787
```

## Run The Local WebMCP Fixture

The fixture requires a Chrome build with the WebMCP API enabled. For local development, enable:

```text
chrome://flags/#enable-webmcp-testing
```

Relaunch Chrome, then start the example in WebMCP mode:

```bash
cd examples/simple-backend
WEBGPT_SIMPLE_MODE=webmcp npm start
```

Open:

```text
http://127.0.0.1:8787/webmcp-fixture
```

Point the extension backend URL at `http://127.0.0.1:8787`, keep the fixture page active, and start a run. The goal text is ignored by this deterministic backend; `Run the deterministic WebMCP fixture` is a useful label.

The run performs these steps:

1. `extract_state` discovers the page-owned tools and their live route metadata.
2. One ordered `run_actions` batch contains a read-only tool followed by the navigation-capable mutation. Both calls use route metadata from the same extracted state and the mutation stays last.
3. The read receives a 4 KiB argument object containing a string longer than 500 characters, 32 array entries, and nested values. The page displays and returns its exact byte length and digest.
4. The mutation sets an ordinary input value, changes visible status, unregisters a marker tool, and registers its replacement under the run-start consent already granted to the extension.
5. One fresh post-batch state must contain the new input `currentValue` and WebMCP tool set, while the ordered execution results must contain both output oracles, before the backend reports success.

The expected and observed digest/length values, last tool result, input value, and registered tool names remain visible on the page as an independent oracle. See Chrome's [WebMCP Imperative API documentation](https://developer.chrome.com/docs/ai/webmcp/imperative-api) for the browser API and flag requirements.

## Configure The Demo Action

The demo action fills one target control and presses Enter.

```bash
WEBGPT_SIMPLE_TARGET_ID=el_45 \
WEBGPT_SIMPLE_FILL_TEXT="example search text" \
PORT=8787 \
npm start
```

Environment variables:

- `PORT`: server port, default `8787`
- `HOST`: bind host, default `127.0.0.1`
- `WEBGPT_SIMPLE_MODE`: set to `webmcp` for the deterministic fixture; otherwise the original hardcoded action mode is used
- `WEBGPT_SIMPLE_TARGET_ID`: WebGPT control ID to fill, default `el_45`
- `WEBGPT_SIMPLE_FILL_TEXT`: text to fill, default `example search text`
- `WEBGPT_SIMPLE_DELAY_MS`: wait before filling, default `10000`

## Test

The automated tests validate the server, page, routed action, exact-argument oracle, mutation state, and original default behavior without requiring Chrome or a live WebMCP implementation:

```bash
cd examples/simple-backend
npm test
```

## What This Proves

Any backend can work with a WebGPT frontend host if it speaks the documented planner command contract.

The default mode implements only the small route subset needed for a one-batch built-in browser action demo. WebMCP mode additionally exercises an ordered multi-tool batch, exact website-tool execution arguments, run-start consent, and post-batch state evidence. It still does not plan connector-tool actions, runtime surface commands, replay artifacts, or navigation handoffs. For the full contract, see:

```text
docs/planner-adapter-contract.md
```
