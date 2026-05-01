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

This repository contains the WebGPT browser frontend and example backend integrations. The private WebGPT planner backend is not part of this repository.

Security-sensitive areas include:

- Chrome extension permissions
- content script page access
- backend URL configuration
- action execution and target resolution
- contributed site adapters

## Supported Versions

Until the first tagged release, security fixes target the default branch.
