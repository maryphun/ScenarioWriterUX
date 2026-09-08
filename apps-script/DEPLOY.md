# Deploy the spreadsheet API

1. Open [Google Apps Script](https://script.google.com/home/start) and create a **new standalone project** named `ScenarioWriterUX API`. This keeps any existing spreadsheet scripts intact.
2. Replace the new project's `Code.gs` with the contents of [Code.gs](Code.gs).
3. In **Project Settings**, enable **Show appsscript.json manifest file in editor**. Replace that manifest with [appsscript.json](appsscript.json). This enables the Advanced Google Sheets service. If you use a custom Google Cloud project, also enable the Google Sheets API there.
4. Select and run **initializeEditor** once. Authorize access with the account that can edit the target spreadsheet. It sets the given spreadsheet ID, generates an access key, and creates two private Drive folders for assets and backups. Re-running it retains existing settings.
5. In **Project Settings → Script properties**, copy **EDITOR_ACCESS_KEY**. Keep it private; enter it directly into the editor's connection dialog. Do not put it in GitHub, a Vite environment variable, or a URL.
6. Choose **Deploy → New deployment → Web app**. Execute as **Me**. Set access to **Anyone**. The API itself requires the generated access key for every data read and write; the spreadsheet and media files stay private.
7. Deploy and copy the URL ending in **/exec**. Give Codex this URL, or paste it into the app's connection settings together with the access key.

`testConnection` is available in the function dropdown. Run it to verify that the deployed account can read the workbook and that the Advanced Sheets service is enabled. It logs only tab and speaker counts.

When updating the backend, use **Deploy → Manage deployments → Edit → New version**. Keep the same deployment URL.

## API behavior

- All data operations use JSON in a `text/plain` POST. Browser fetch follows the Google ContentService redirect. No JSONP, URL secrets, `no-cors`, or unreadable success responses are used.
- The API is pinned to `SPREADSHEET_ID`, initially `1nyJ6dGCOI1a9f9Nujc7XhxoHXj7qh1cmeDPvAFdLLx4`. It does not accept an arbitrary spreadsheet ID from callers.
- Only visible script tabs with the exact eight known column headers can be written. `Master` is read only.
- Save requests compare a content-and-format revision, acquire a script lock, retain a private JSON backup, and submit a single Sheets batch. Stale saves match rows by unique `LineID`, then exact value and legacy order fallbacks. Remote cell edits and row additions, deletions, or reordering are preserved while local cells are applied to safely matched rows. A same-cell edit, a local edit to a remotely deleted row, or a simultaneous local structure change is rejected with a precise message. Human edits made directly in Sheets are not locked by Apps Script during the instant they are typed.
- Revision payloads are canonicalized before hashing because the Sheets API does not guarantee JSON object property order. This prevents unchanged cell formatting from causing false conflict errors.
- Existing cell formats, validation and notes follow source rows. Column I onward and the header row are outside the write range. Formulas in script columns cause a refusal to save, rather than being converted to text.
- A row containing only bracketed text in column A is formatted black across A:H with bold white text. These production-instruction rows remain ordinary string values and are ignored by the editor's node and Yarn logic.
- All new cell values are explicit strings, so text starting with `=` remains text.
- Assets are private Drive files returned only through authenticated API requests. Anyone with the editor key can read/write this workbook and its asset library. Rotate `EDITOR_ACCESS_KEY` in Script properties if team access changes.
- Deleting a shared asset removes it from the shared index and moves its Drive file to Trash. Restoring the file from Drive Trash does not automatically add it back to the shared index.
- Backups are in `ScenarioWriterUX Backups`. They contain the prior eight-column values and formatting. No backup is automatically deleted.
- HTTP ContentService cannot set custom response status codes; callers must inspect the `{ok,data,error}` JSON envelope.

## Smoke test after deployment

Open the editor, enter `/exec` and the key, and connect. Confirm all eight sheet titles/character names load. On a disposable script tab with the eight required headers, save a test line, reload, and confirm the exact text. Register an image, share it, and load shared assets in a second browser session. Delete that disposable tab manually after verification. Do not use your production tutorial for a destructive test.

Official references: [Web apps](https://developers.google.com/apps-script/guides/web), [ContentService and redirects](https://developers.google.com/apps-script/guides/content), [Advanced Sheets service](https://developers.google.com/apps-script/advanced/sheets).
