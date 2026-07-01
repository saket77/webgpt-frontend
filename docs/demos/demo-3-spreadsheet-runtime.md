# Demo 3: WebGPT Works Across Excel And Google Sheets

This Short shows WebGPT handling spreadsheet tasks across Microsoft Excel and Google Sheets.

The point is simple: once OAuth is connected, the user should not have to care which spreadsheet product is open. WebGPT should take the task, route it through the right connector, and edit the sheet directly.

## What It Shows

- Microsoft Excel and Google Sheets are both supported spreadsheet surfaces.
- OAuth is already connected before the run starts.
- The user gives a normal spreadsheet task in plain English.
- WebGPT edits the sheet directly through the active spreadsheet connector.
- The planner loop stays the same while the runtime chooses the correct spreadsheet executor.

## Why It Matters

Spreadsheets are not ordinary DOM pages. Their grids are virtualized, cell state is structured, and formulas need real spreadsheet semantics. WebGPT treats them as API-backed surfaces instead of click targets.

This demo is the clean proof of the connector model: one agent loop, multiple real work tools.

## Demo Message

WebGPT is moving past one-off browser demos. It can work inside the spreadsheet tools people already use.

## Repro Shape

1. Connect Microsoft Excel and Google Sheets through settings.
2. Open a supported workbook or sheet.
3. Ask WebGPT to create or update spreadsheet data.
4. Confirm it writes rows, formulas, and totals through the connector rather than DOM clicking.
