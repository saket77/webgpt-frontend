# Demo 5: WebGPT Reads Dotloop PDFs

This Short shows WebGPT handling a Dotloop PDF flow with a tenant source form and a lease agreement template.

WebGPT reads rendered PDF pages with vision, maps labels like tenant name and property address to real editable Dotloop overlay boxes, and fills the correct fields.

## What It Shows

- Navigating inside a Dotloop loop to work across multiple documents.
- Reading a tenant source form to extract values like name and address.
- Opening a lease agreement template in the same loop.
- Sending rendered PDF page images through backend vision.
- Returning possible field names and coordinates for the editable overlays.
- Matching vision boxes to real Dotloop fields with rectangle overlap and vertical-position preference.
- Filling actual Dotloop overlay fields rather than guessing at visual blanks.

## Why It Matters

Many business documents are rendered as images or canvas-like views. The useful text and labels may be visible to a human but not available as normal DOM text.

This demo shows the PDF reader path inside WebGPT's connector model: the browser gathers document facts, the backend runs vision, and the planner gets structured extraction data it can use to decide what to fill.

## Demo Message

WebGPT can understand rendered PDF document views and fill real editable fields in a business workflow.

## Repro Shape

1. Open a Dotloop loop with a tenant source form and a lease agreement template.
2. Ask WebGPT to use the tenant form values to fill the lease template.
3. Let WebGPT read the source PDF and extract tenant name and address.
4. Let WebGPT read the template PDF, map labels to editable overlay boxes, and fill the matching fields.
5. Confirm the filled fields landed on the real Dotloop overlays.
