# Security Policy

## Reporting A Vulnerability

Please do not open a public issue for security-sensitive reports.

Use GitHub's private vulnerability reporting or Security Advisory flow for this repository. If that is unavailable, contact the maintainer through the GitHub profile listed on the repository.

Include:

- affected version or commit
- reproduction steps
- expected impact
- any suggested fix

## Scope

This repository contains the WebGPT frontend runtime workspace, including the Chrome extension host, Browserbase cloud-browser host, shared page runtime, shared controller core, and example backend integrations. Backend services that implement the planner contract are separate systems with their own security boundaries.

Security-sensitive areas include:

- Chrome extension permissions
- content script page access
- backend URL configuration
- action execution and target resolution
- contributed site adapters and connector-tool executors
- website-provided WebMCP definitions, arguments, execution, and output
- Browserbase API keys, project IDs, session links, and Live View URLs
- cloud run JSONL logs under `.webgpt-cloud-runs/`

## Browserbase Credentials And Logs

Live Browserbase runs require `BROWSERBASE_API_KEY` and `BROWSERBASE_PROJECT_ID`. Store these in shell environment variables or ignored `.env.local` files. Do not commit Browserbase credentials.

Browserbase Live View URLs can expose active browser activity for the current session. Treat them as sensitive debugging links.

Cloud run logs under `.webgpt-cloud-runs/` may contain URLs, task goals, page-derived facts, planner summaries, or extracted business data. The directory is ignored by Git, but logs should still be handled as user/workflow data.

## WebMCP Trust Boundary

WebMCP tool names, descriptions, schemas, annotations, and results are supplied by the active website. Treat all of them as untrusted page content: they can describe capabilities or data, but they cannot override the user's goal, system policy, runtime permissions, or run-start consent boundary. `untrustedContentHint: false` is not a trust grant.

WebGPT limits discovery/schema size, rejects invalid or oversized executable arguments instead of truncating them, bounds returned output, and keeps prompt/history compaction separate from the exact execution payload. Before every invocation, the page runtime re-discovers the current-frame live handle and verifies its page name, origin, schema hash, and safety annotations.

Starting a run authorizes planner-selected DOM, connector, and WebMCP actions that remain within the user goal. WebMCP does not add a second mutation-confirmation step. WebMCP actions remain excluded from replay because replay cannot safely reuse a stale page-owned handle or schema.

Generic state extraction never records password, file, or hidden input values. Ordinary control values used for post-action verification are bounded before leaving the page.

See [WebMCP integration](./docs/webmcp.md) for the complete execution and evidence contract.

## Supported Versions

Until the first tagged release, security fixes target the default branch.
