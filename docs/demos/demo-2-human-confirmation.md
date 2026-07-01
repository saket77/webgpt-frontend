# Demo 2: WebGPT Works With Microsoft Excel

This Short shows WebGPT moving beyond website-only automation and operating Microsoft Excel as a real work surface.

## What It Shows

- WebGPT connects to Microsoft Excel through the settings flow.
- The setup uses tenant ID, client ID, and the displayed redirect URI.
- After OAuth is connected, WebGPT can create a sample expense sheet.
- The generated workbook includes rows plus a total cell, written through the Excel runtime.

## Why It Matters

Spreadsheets are not ordinary DOM pages. WebGPT treats Excel as an API-backed runtime surface instead of trying to click cells in a canvas-like UI.

This demo shows the connector model expanding from browser pages into real work tools.

## Demo Message

WebGPT is moving from website demos into real work tools.

## Repro Shape

1. Open WebGPT settings.
2. Configure Microsoft Excel with tenant ID, client ID, and redirect URI.
3. Connect Excel through OAuth.
4. Open a supported Excel workbook.
5. Ask WebGPT to create a sample expense sheet with rows and a total cell.
