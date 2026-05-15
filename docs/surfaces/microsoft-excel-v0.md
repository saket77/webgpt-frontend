# Microsoft Excel Surface v0

`microsoft_excel` is a runtime surface for Excel workbooks opened in Microsoft 365 / SharePoint. It keeps planning in the backend and executes workbook operations in the extension through Microsoft Graph.

## Frontend State

The runtime returns compact workbook state:

```json
{
  "surface": "microsoft_excel",
  "authStatus": "authenticated",
  "url": "https://...",
  "workbookDriveId": "drive-id",
  "workbookItemId": "item-id",
  "workbookTitle": "CRM.xlsx",
  "workbookWebUrl": "https://...",
  "activeWorksheetName": "Customers",
  "activeRange": "B12",
  "worksheets": [
    {
      "id": "{worksheet-id}",
      "name": "Customers",
      "position": 0,
      "visibility": "Visible",
      "active": true
    }
  ],
  "visibleGrid": {
    "address": "Customers!A1:T50",
    "range": "Customers!A1:T50",
    "startRow": 0,
    "startColumn": 0,
    "rowCount": 50,
    "columnCount": 20,
    "values": []
  }
}
```

The first planning snapshot is bounded to `A1:T50`.

## Commands

Commands are executed by `background/runtime/microsoftExcel.js` through Microsoft Graph.

### `read_range`

Reads a bounded A1 range.

```json
{
  "name": "read_range",
  "worksheetName": "Customers",
  "range": "A1:T50"
}
```

Returns `address`, `values`, `rowCount`, `columnCount`, and index metadata used by extraction.

### `write_range`

Writes a rectangular block of values.

```json
{
  "name": "write_range",
  "worksheetName": "Customers",
  "range": "F5:F13",
  "values": [["TRUE"], ["TRUE"]]
}
```

### `append_rows`

Appends rows below the worksheet's used range.

```json
{
  "name": "append_rows",
  "worksheetName": "Customers",
  "startColumn": "A",
  "values": [["Acme", "Open", "Call Monday"]]
}
```

### `find_rows`

Reads a bounded range and returns rows matching a query.

```json
{
  "name": "find_rows",
  "worksheetName": "Customers",
  "range": "A1:T200",
  "query": "Acme",
  "columns": ["A", "B"],
  "matchMode": "contains",
  "limit": 20
}
```

### `format_range`

Applies basic formatting.

```json
{
  "name": "format_range",
  "worksheetName": "Customers",
  "range": "A1:F1",
  "format": {
    "background": "#000000",
    "textColor": "#ffffff",
    "bold": true,
    "columnWidth": 90
  }
}
```

### `set_active_range`

Records the intended active range. In v0 this is API-side bookkeeping; it does not reliably manipulate the Excel web UI selection.

```json
{
  "name": "set_active_range",
  "worksheetName": "Customers",
  "range": "F13"
}
```

### `list_worksheets`

Returns workbook worksheets. State extraction already includes worksheets, so this is mainly a fallback command.

```json
{
  "name": "list_worksheets"
}
```

## Auth

The runtime uses `chrome.identity.launchWebAuthFlow` with Microsoft auth code + PKCE. Tokens stay in extension storage; the backend never receives Microsoft tokens. Users configure Microsoft Excel from the WebGPT side panel settings page with their Microsoft Entra tenant ID, application client ID, and Graph scopes.

The Entra redirect URI must match the URI shown in WebGPT settings:

```text
https://<extension-id>.chromiumapp.org/microsoft
```

## Replay

Replay steps use the same surface command shape:

```json
{
  "surface": "microsoft_excel",
  "commandName": "write_range",
  "command": {
    "name": "write_range",
    "worksheetName": "Customers",
    "range": "F5:F13",
    "values": [["TRUE"]]
  }
}
```
