# Google Sheets Surface v0

This document mirrors the Google Sheets runtime vocabulary implemented by the frontend and taught to compatible planner backends.

The frontend executes these commands through Chrome identity and the Google Sheets API. The backend chooses commands, keeps canonical history, summarizes outcomes, and creates replay artifacts.

## Surface

```json
{
  "surface": "google_sheets",
  "version": "v0",
  "purpose": "Plan structured Google Sheets work against a curated API-like runner surface."
}
```

## State Shape

`extract_state` on a Google Sheets tab returns bounded spreadsheet state:

```json
{
  "surface": "google_sheets",
  "authStatus": "authenticated",
  "goal": "Update the customer status",
  "step": 1,
  "timestamp": "2026-05-03T00:00:00.000Z",
  "url": "https://docs.google.com/spreadsheets/d/spreadsheet-id/edit#gid=0",
  "spreadsheetId": "spreadsheet-id",
  "spreadsheetTitle": "CRM",
  "activeSheetName": "Customers",
  "activeRange": "D12",
  "formulaBarValue": "",
  "sheetTabs": [
    {
      "sheetId": 0,
      "title": "Customers",
      "index": 0,
      "hidden": false,
      "active": true
    }
  ],
  "visibleGrid": {
    "range": "'Customers'!A1:T50",
    "startRow": 0,
    "startColumn": 0,
    "rowCount": 50,
    "columnCount": 20,
    "values": []
  }
}
```

The default planning snapshot is `A1:T50` on the active sheet. Runtimes should keep snapshots bounded and planner-readable.

## Commands

### `read_values`

Read a bounded A1 range from the current spreadsheet.

Required:

- `range`

Optional:

- `sheetName`
- `majorDimension`

Returns:

- `range`
- `values`
- `rowCount`
- `columnCount`

Example:

```json
{
  "name": "read_values",
  "sheetName": "Customers",
  "range": "A1:F25"
}
```

### `write_values`

Write a rectangular set of values to an A1 range.

Required:

- `range`
- `values`

Optional:

- `sheetName`
- `inputOption`

Returns:

- `updatedRange`
- `updatedRows`
- `updatedColumns`
- `updatedCells`

Example:

```json
{
  "name": "write_values",
  "sheetName": "Customers",
  "range": "D12:E12",
  "inputOption": "USER_ENTERED",
  "values": [["Done", "Followed up"]]
}
```

### `append_values`

Append one or more rows to the end of a table-like range.

Required:

- `range`
- `values`

Optional:

- `sheetName`
- `inputOption`
- `insertDataOption`

Returns:

- `tableRange`
- `updatedRange`
- `updatedRows`
- `updatedCells`

Example:

```json
{
  "name": "append_values",
  "sheetName": "Customers",
  "range": "A:F",
  "inputOption": "USER_ENTERED",
  "insertDataOption": "INSERT_ROWS",
  "values": [["Acme", "Alice", "alice@example.com", "New", "Call tomorrow"]]
}
```

### `find_rows`

Find rows in a bounded range by exact or contains matching across visible values.

Required:

- `range`
- `query`

Optional:

- `sheetName`
- `columns`
- `matchMode`
- `caseSensitive`
- `limit`

Returns:

- `matches`

Example:

```json
{
  "name": "find_rows",
  "sheetName": "Customers",
  "range": "A1:T200",
  "query": "Acme",
  "columns": ["A", "B"],
  "matchMode": "contains",
  "limit": 10
}
```

### `format_range`

Apply basic cosmetic formatting such as background, text color, bold, alignment, or width.

Required:

- `range`
- `format`

Optional:

- `sheetName`

Returns:

- `updatedRange`
- `appliedFormat`

Example:

```json
{
  "name": "format_range",
  "sheetName": "Customers",
  "range": "A1:F1",
  "format": {
    "background": "#000000",
    "textColor": "#ffffff",
    "bold": true,
    "horizontalAlignment": "CENTER",
    "width": 160
  }
}
```

### `set_active_range`

Move the user's visible selection to an A1 range when the browser UI should follow the data operation.

Required:

- `range`

Optional:

- `sheetName`

Returns:

- `activeRange`

Example:

```json
{
  "name": "set_active_range",
  "sheetName": "Customers",
  "range": "D12"
}
```

## Command Result

The frontend reports Sheets execution through:

```json
{
  "type": "google_sheets_commands_executed",
  "surface": "google_sheets",
  "command": {
    "type": "run_google_sheets_commands",
    "commands": []
  },
  "execution": {
    "ok": true,
    "surface": "google_sheets",
    "summary": "Executed 1 Google Sheets command.",
    "results": []
  },
  "postState": {}
}
```

Read and find commands should include returned values or matches in `execution.results` so compatible backends can preserve extracted data and summarize verified facts.

## Replay Step Shape

Sheets replay steps use the same command vocabulary:

```json
{
  "surface": "google_sheets",
  "commandName": "write_values",
  "command": {
    "name": "write_values",
    "sheetName": "Customers",
    "range": "D12",
    "values": [["Done"]]
  }
}
```

The frontend routes pure Google Sheets replay batches through the Google Sheets runtime instead of the DOM replay runner.
