# Simple Backend Example

This is a tiny WebGPT-compatible backend for local testing. The extension defaults to the hosted WebGPT planner; use this example when you want to inspect the contract locally or test frontend changes without a real planner.

This example does not plan, call an LLM, inspect the page, or choose controls. It returns one hardcoded `run_actions` command so frontend contributors can see the backend contract in motion.

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
- `WEBGPT_SIMPLE_TARGET_ID`: WebGPT control ID to fill, default `el_45`
- `WEBGPT_SIMPLE_FILL_TEXT`: text to fill, default `example search text`
- `WEBGPT_SIMPLE_DELAY_MS`: wait before filling, default `10000`

## What This Proves

Any backend can work with the extension if it speaks the documented planner command contract.

This example implements only the small route subset needed for a one-batch built-in browser action demo. It does not plan connector-tool actions, runtime surface commands, replay artifacts, or navigation handoffs. For the full contract, see:

```text
docs/planner-adapter-contract.md
```
