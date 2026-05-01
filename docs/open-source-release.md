# Open Source Release Plan

This folder is intended to become the root of the public `webgpt-frontend` repository.

The private monorepo can keep the full WebGPT system, including the private planner backend. The public repository should contain only:

- this frontend extension
- frontend integration docs
- content-script site adapters
- compatible backend examples under `examples/`

Do not publish the private planner backend, planner artifacts, run-debug payloads, successful replay artifacts, or local runtime files.

## Recommended Repo Strategy

Use a separate public GitHub repository.

Do not start with a Git submodule. Submodules are useful later if the public frontend becomes the source of truth, but they add friction for the first launch.

For the first release:

1. Keep the current private monorepo as the working system repo.
2. Keep `FrontEnd/` self-contained.
3. Export `FrontEnd/` into a clean sibling folder.
4. Initialize a new Git repo from that clean folder.
5. Push that repo to GitHub as private first.
6. Review it on GitHub.
7. Flip visibility to public when ready.

## Why Not Publish The Current Repo

The current repo contains private backend code and local planner artifacts. Making it public would expose more than the frontend contract.

The public repo should have a clean root:

```text
webgpt-frontend/
  background/
  content-scripts/
  docs/
  examples/
  icons/
  sidepanel-app/
  manifest.json
  README.md
  CONTRIBUTING.md
  LICENSE
  SECURITY.md
```

## Export Commands

From the parent directory that contains the private `webgpt-backend` repo:

```bash
mkdir -p webgpt-frontend
rsync -a --delete \
  --exclude '.git' \
  --exclude '.DS_Store' \
  --exclude 'sidepanel-app/node_modules/' \
  --exclude 'sidepanel-app/dist/' \
  webgpt-backend/web-agent-chrome-extension/FrontEnd/ \
  webgpt-frontend/
```

Then initialize the public repo:

```bash
cd webgpt-frontend
git init
git add .
git commit -m "Initial open-source frontend release"
```

Create a GitHub repository as private first, push, review, then make it public.

Example with GitHub CLI:

```bash
gh repo create webgpt-frontend --private --source=. --remote=origin --push
```

When everything looks right:

```bash
gh repo edit --visibility public
```

## Later Sync Options

After launch, choose one source-of-truth model.

Option A: public repo is source of truth.

- Replace `FrontEnd/` in the private monorepo with a Git submodule or periodic vendor copy.
- Best if outside contributors become active.

Option B: private monorepo remains source of truth.

- Export `FrontEnd/` to the public repo for releases.
- Best while the project is still changing quickly.

Option C: use Git subtree.

- Keeps history and allows syncing a subdirectory to another repo.
- More powerful than copying, but harder to reason about during the first public launch.

For day one, use Option B. It is simplest and least risky.

## Pre-Public Checklist

- `README.md` explains the frontend/backend boundary.
- `examples/simple-backend` runs without private code.
- `docs/planner-adapter-contract.md` explains compatible backend expectations.
- `docs/site-adapter-authoring.md` explains how to add site adapters.
- `LICENSE`, `CONTRIBUTING.md`, and `SECURITY.md` exist.
- `sidepanel-app/node_modules/` is not present.
- `sidepanel-app/dist/` is not present unless intentionally shipping a built artifact.
- no `.DS_Store` files are present.
- no private backend files are present.
- no planner artifacts or run-debug logs are present.
- no secrets or local credentials are present.
