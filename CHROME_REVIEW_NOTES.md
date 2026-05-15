# Chrome Web Store Review Notes

WebGPT is a user-initiated browser automation side panel. It observes the active tab, sends structured page state to the default or user-configured backend, receives a small action plan, and executes DOM actions only after the user starts a run.

## Permission Rationale

- `sidePanel`: Required to show the WebGPT control surface where the user enters a goal, starts/stops runs, reviews event logs, and provides human guidance.
- `storage`: Required to keep local extension session state, event history, first-run disclosure acceptance, and in-progress run metadata. This data is stored by the extension and is not used for background browsing surveillance.
- `tabs`: Required to identify the active tab, attach a run to the correct tab, handle new-tab handoff, and keep the side panel synchronized with the tab that owns the active user-initiated session.
- `scripting`: Required to dynamically inject WebGPT's local content scripts into the user-selected tab after the user starts or attaches a run. The extension does not load remote code.
- `webNavigation`: Required to detect same-tab navigation, enumerate frames for page-state extraction, and resume the user-initiated agent loop after navigation completes.
- `identity`: Required for user-initiated Google Sheets OAuth through `chrome.identity.getAuthToken` and Microsoft Excel OAuth through `chrome.identity.launchWebAuthFlow`. Tokens are used by the extension runtime for the selected spreadsheet/workbook surface and are not sent to the WebGPT backend.

## API Host Access

- `https://sheets.googleapis.com/*`: Required for the Google Sheets runtime to read and update the spreadsheet selected by the user through Google Sheets API calls after Google OAuth consent.
- `https://graph.microsoft.com/*`: Required for the Microsoft Excel runtime to resolve the selected Microsoft 365/SharePoint workbook and execute Microsoft Graph workbook API calls after Microsoft OAuth consent.
- `https://login.microsoftonline.com/*`: Required for the Microsoft Excel runtime to exchange and refresh OAuth authorization-code + PKCE tokens. The interactive Microsoft sign-in is launched by user action through Chrome identity.

## Chrome Web Store Paste-Ready Host Justifications

`https://sheets.googleapis.com/*`

Required for the Google Sheets runtime. After the user starts a spreadsheet workflow and completes Google OAuth consent, WebGPT uses this host to read bounded spreadsheet state and execute user-requested Sheets API updates. Google access tokens stay in Chrome's identity token cache and are not sent to the WebGPT backend.

`https://graph.microsoft.com/*`

Required for the Microsoft Excel runtime. After the user configures their own Microsoft Entra app and completes Microsoft OAuth consent, WebGPT uses Microsoft Graph to resolve the selected Microsoft 365 or SharePoint workbook and execute user-requested workbook API operations. Microsoft access tokens stay in extension local storage and are not sent to the WebGPT backend.

`https://login.microsoftonline.com/*`

Required for Microsoft Excel OAuth. WebGPT uses this host only for the user-initiated Microsoft authorization-code + PKCE flow, including token exchange and refresh for the user's configured Microsoft Entra app. The interactive sign-in is launched through `chrome.identity.launchWebAuthFlow`.

`http://*/*` and `https://*/*`

Required as optional host permissions so WebGPT can run browser automation on arbitrary websites selected by the user. Access is requested after the user opens the side panel, enters a goal, starts a run, and accepts the pre-run disclosure/site access prompt. WebGPT does not statically inject scripts into every site and does not run background browsing or scraping.

## Optional Host Access

- `http://*/*` and `https://*/*` are optional host permissions. They are requested only after the user accepts the pre-run disclosure and starts using WebGPT.
- Broad host access is required because WebGPT is designed to operate on arbitrary user-selected websites using the DOM. It is not site-specific and does not rely on website APIs.

## Execution Model

- Content scripts are not statically injected into all pages.
- WebGPT injects local content scripts dynamically through `chrome.scripting.executeScript`.
- Runs are user-initiated from the side panel.
- The extension stores ephemeral session state locally and uses the backend as the reasoning/session source of truth.
- Microsoft Excel tenant ID, application client ID, and scopes are configured by the user from the side panel settings page. They are stored in extension local storage and are not declared as custom manifest keys.
