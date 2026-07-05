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
- Browserbase API keys, project IDs, session links, and Live View URLs
- cloud run JSONL logs under `.webgpt-cloud-runs/`

## Browserbase Credentials And Logs

Live Browserbase runs require `BROWSERBASE_API_KEY` and `BROWSERBASE_PROJECT_ID`. Store these in shell environment variables or ignored `.env.local` files. Do not commit Browserbase credentials.

Browserbase Live View URLs can expose active browser activity for the current session. Treat them as sensitive debugging links.

Cloud run logs under `.webgpt-cloud-runs/` may contain URLs, task goals, page-derived facts, planner summaries, or extracted business data. The directory is ignored by Git, but logs should still be handled as user/workflow data.

## Supported Versions

Until the first tagged release, security fixes target the default branch.
