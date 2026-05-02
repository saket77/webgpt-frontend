# Chrome Web Store Review Notes

WebGPT is a user-initiated browser automation side panel. It observes the active tab, sends structured page state to the default or user-configured backend, receives a small action plan, and executes DOM actions only after the user starts a run.

## Permission Rationale

- `sidePanel`: Required to show the WebGPT control surface where the user enters a goal, starts/stops runs, reviews event logs, and provides human guidance.
- `storage`: Required to keep local extension session state, event history, first-run disclosure acceptance, and in-progress run metadata. This data is stored by the extension and is not used for background browsing surveillance.
- `tabs`: Required to identify the active tab, attach a run to the correct tab, handle new-tab handoff, and keep the side panel synchronized with the tab that owns the active user-initiated session.
- `scripting`: Required to dynamically inject WebGPT's local content scripts into the user-selected tab after the user starts or attaches a run. The extension does not load remote code.
- `webNavigation`: Required to detect same-tab navigation, enumerate frames for page-state extraction, and resume the user-initiated agent loop after navigation completes.

## Optional Host Access

- `http://*/*` and `https://*/*` are optional host permissions. They are requested only after the user accepts the pre-run disclosure and starts using WebGPT.
- Broad host access is required because WebGPT is designed to operate on arbitrary user-selected websites using the DOM. It is not site-specific and does not rely on website APIs.

## Execution Model

- Content scripts are not statically injected into all pages.
- WebGPT injects local content scripts dynamically through `chrome.scripting.executeScript`.
- Runs are user-initiated from the side panel.
- The extension stores ephemeral session state locally and uses the backend as the reasoning/session source of truth.
