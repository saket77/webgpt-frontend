# Demo 3: Spreadsheet Runtime

This demo shows WebGPT operating on spreadsheet data through a runtime surface instead of pretending spreadsheet canvases are ordinary DOM pages.

## What It Shows

- Detecting Google Sheets or Microsoft Excel as a non-DOM surface
- Extracting bounded workbook or spreadsheet state
- Executing curated commands such as `read_values`, `write_values`, `find_rows`, `read_range`, or `write_range`
- Keeping OAuth tokens in the extension, not the backend

## Why It Matters

Some products are better controlled through durable APIs and structured state. Runtime surfaces let WebGPT keep the same planner/controller loop while using a better executor for the job.

## Repro Checklist

1. Open a supported spreadsheet or workbook.
2. Connect the relevant runtime auth if needed.
3. Ask WebGPT to read or update a bounded range.
4. Confirm the command result and post-command state are reflected in run history.

