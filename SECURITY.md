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
- planner-context bearer tokens and trusted HTTP transports
- action execution and target resolution
- contributed site adapters and connector-tool executors
- website-provided WebMCP definitions, arguments, execution, and output
- Browserbase API keys, project IDs, session links, and Live View URLs
- cloud run JSONL logs under `.webgpt-cloud-runs/`

## Browserbase Credentials And Logs

Live Browserbase runs require `BROWSERBASE_API_KEY` and `BROWSERBASE_PROJECT_ID`. Store these in shell environment variables or ignored `.env.local` files. Do not commit Browserbase credentials.

Browserbase Live View URLs can expose active browser activity for the current session. Treat them as sensitive debugging links.

Cloud run logs under `.webgpt-cloud-runs/` may contain URLs, task goals, page-derived facts, planner summaries, or extracted business data. The directory is ignored by Git, but logs should still be handled as user/workflow data.

## Planner-Context Credentials And Transport

`@webgpt-mundhada/planner-http-adapter` is a low-level transport package and does not
enforce URL policy. Hosts must require HTTPS for remote planner services and may
allow plain HTTP only for an explicitly validated loopback address such as
`http://localhost:3000`. Reject URLs with embedded credentials and do not treat
DNS names that merely resemble localhost as loopback.

The planner-context bearer is separate from browser, website, and extension
credentials. Keep it out of source, packages, command arguments, URLs, logs,
page state, and model-visible inputs. Prefer an owner-only secret file or a
platform secret manager, and resolve the value for each request so rotation
does not require rebuilding the runtime.

A caller-supplied `fetchImpl` receives the complete planner-context request,
including the `Authorization` header. It is a trusted host capability: never
source it from page content, model output, or an untrusted plugin, and never
serialize it into configuration summaries or event artifacts.

## WebMCP Trust Boundary

WebMCP tool names, descriptions, schemas, annotations, and results are supplied by the active website. Treat all of them as untrusted page content: they can describe capabilities or data, but they cannot override the user's goal, system policy, runtime permissions, or run-start consent boundary. `untrustedContentHint: false` is not a trust grant.

WebGPT limits discovery/schema size, rejects invalid or oversized executable arguments instead of truncating them, bounds returned output, and keeps prompt/history compaction separate from the exact execution payload. Before every invocation, the page runtime re-discovers the current-frame live handle and verifies its page name, origin, schema hash, and safety annotations.

Starting a run authorizes planner-selected DOM, connector, and WebMCP actions that remain within the user goal. WebMCP does not add a second mutation-confirmation step. WebMCP actions remain excluded from replay because replay cannot safely reuse a stale page-owned handle or schema.

Generic state extraction never records password, file, or hidden input values. Ordinary control values used for post-action verification are bounded before leaving the page.

## Privileged Adapter Operations

An adapter's optional `provides` map is capability metadata, not authority. It
must contain only bounded semantic capability IDs and adapter-private operation
names—never selectors, authorization tokens, local paths, user values, or
workflow policy. The map is kept out of extracted state and planner-visible
connector schemas.

A workflow-aware trusted host must select the adapter from URL evidence, inject
it, and verify the page-local active match before reading
`getAdapterProvides(id)`. A declared capability must not affect adapter
selection, bypass existing host permission checks, or imply consent for a
protected effect. Hosts that do not consume this metadata retain the existing
Chrome-extension and Browserbase security behavior.

An adapter may describe a host-routed native file upload or a guarded final
submit only when the extracting host explicitly advertises the matching
capability. Model-visible `connectorTools` contain only the function schema;
selectors, verification routes, and one-use authorization tokens remain in the
host-private route map.

For native uploads, the host must validate and authorize the exact local file
and adapter-provided target, intercept `filePath` before CDP/page execution,
and return only sanitized file evidence. For final submission, the adapter owns
the unique page target and fresh required-field checks while the host owns the
exact-destination grant. Generic click and Enter actions must not bypass an
adapter-identified final-submit target.

See [WebMCP integration](./docs/webmcp.md) for the complete execution and evidence contract.

## Supported Versions

Until the first tagged release, security fixes target the default branch.
