# Demo 4: Spreadsheet Rows Become Browser Tasks

This Short shows the bigger cross-surface workflow: WebGPT takes addresses from a spreadsheet, looks them up on Philadelphia's property website, extracts the requested fields, and writes the answers back into the sheet.

## What It Shows

- Reading addresses from a spreadsheet.
- Switching into the browser to search Philadelphia's property website.
- Extracting fields like zoning, owner, frontage, and lot size.
- Returning to the spreadsheet and writing results into the correct rows.
- Keeping row context across the spreadsheet -> browser -> spreadsheet handoff.

## Why It Matters

Real work rarely stays in one app. A user starts with rows in a sheet, needs data from a website, then needs the result back in the sheet.

This demo shows WebGPT acting as one continuous agent across both surfaces instead of forcing the user to copy, paste, and reconcile the in-between by hand.

## Demo Message

Spreadsheet rows can become browser tasks, and browser findings can flow back into the spreadsheet.

## Repro Shape

1. Open a spreadsheet with address rows and blank result columns.
2. Ask WebGPT to enrich the rows from Philadelphia's property site.
3. Let WebGPT read the sheet, search each address, and extract the requested fields.
4. Confirm the results are written back into the original rows.
