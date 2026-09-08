# シナリオエディター

Vue 3 + Vite + Tailwind CSS. A writer edits dialogue and directions while a central 16:9 stage reconstructs the selected line. GitHub Pages hosts the frontend; a Google Apps Script API reads/writes the existing Google Sheet.

## Development

Requires Node 22.12+ (Node 24 recommended).

```sh
npm ci
npm run dev
npm test
npm run build
```

## Deployment

1. Deploy the [Apps Script API](apps-script/DEPLOY.md).
2. Push this directory as the root of `maryphun/ScenarioWriterUX`.
3. In the GitHub repository, choose **Settings → Pages → Source → GitHub Actions**. The included workflow builds, tests, and deploys the editor. It runs on `main` and `codex/scenario-editor`, or manually.
4. Optionally set the repository Actions variable `APPS_SCRIPT_URL` to the public `/exec` deployment URL. The URL can also be entered in the app, so no rebuild is required to connect.
5. Open the published app, click connection settings, and enter the Web App URL and the private access key. The frontend includes no secret and no production scenario text.

## Writer workflow

- Pick a spreadsheet tab and node. Click a line to reconstruct its scene.
- Choose a speaker, type, and press Enter for the next line. Shift+Enter inserts a newline. Japanese IME confirmation is protected.
- Use “制作指示を追加” to place a non-gameplay instruction between dialogue lines. The editor keeps the brackets visible, shows the instruction as a black row, and excludes it from Yarn export.
- Drop images into the background or sprite section. A background has instant/fade mode, duration, and fade color (black by default).
- Add any number of character IDs. Each ID has its own image, position, scale, flip, tint, and visibility. Reusing an ID updates that character. Drag a character in the preview or use the position control. A named dialogue line automatically keeps the matching character ID in focus and slightly grays the other visible characters; narration leaves everyone at their normal color. Character IDs should therefore exactly match the speaker names in `Master`.
- Toka face assets (`Ch_Toka_Face_*`) are previewed over `Ch_Toka_Body_Casual`, which represents her game-profile appearance in the browser. The Yarn export keeps only the face command so Unity can combine it with `PlayerProfile.TokaCurrentBody` at runtime. Choosing another Toka sprite, such as `Ch_Toka_TF_angry`, displays that sprite by itself as an explicit override.
- Commands can be inserted using forms or dragged from the palette, reordered, edited, and removed. The raw command field preserves unsupported/legacy text.
- Create choices with a new node name or type an existing node. Preview choices navigate the graph and carry scene state into the destination. Return to the branch point with “分岐元へ”. Directly selecting a scene previews it from a clean state.
- Previous/next controls are centered under the preview. Play replays the current line's commands; seeking is silent.
- Every page load starts without scenario data and opens the connection dialog. The connected state appears only after a fresh spreadsheet read; cached workbooks and the old sample are never restored. Media can remain in IndexedDB, while scenario edits remain in the current page until “シートに反映” succeeds. Closing a page with pending edits triggers the browser's unsaved-changes warning.
- Saves match existing rows by unique `LineID`, with exact-row and legacy order fallbacks. If another writer edited different cells or added, removed, or reordered rows after the current writer's last read, the backend preserves the current sheet structure and applies local edits to safely matched rows. A same-cell edit, a local edit to a remotely deleted row, or a simultaneous local structure change stops with a conflict instead of silently discarding either writer's work. Existing `Master` entries supply speaker names/colors, without displaying that technical label in the editor.
- Share each asset through its settings to store it in the API's private Drive folder. Other sessions load those assets on connection or using “共有素材を読み込む”. Local-only assets are labeled accordingly. Uploads are limited to 10 MB per file; there is no fixed character count limit.
- Use the trash icon on an asset row to remove it. Local assets are deleted from browser storage. Shared assets are removed from the shared index and moved to Google Drive Trash, where they remain recoverable. The editor warns when commands still reference the asset.

## Compatibility and boundaries

- The eight existing columns are preserved. Empty node cells are interpreted as continuation in the editor, then filled for meaningful rows when a changed tab is saved, matching the Unity converter's requirement. Blank separator rows remain. The review shows how many node names will be filled.
- A row containing only bracketed text in column A is a production instruction. It belongs visually to the surrounding scene but is never treated as a node. The backend formats A:H black with bold white text, and the Yarn exporter omits the row.
- Imported leading `*` node names are not silently renamed. Legacy destinations can be previewed when unambiguous; invalid/missing/exact-name mismatches must be resolved before Yarn export.
- The renderer implements the provided command families and aliases. Its default preview uses a 1.1 stage-height sprite and a -175 px bottom offset at 1080p; both values remain adjustable. Missing images remain labeled placeholders.
- The preview approximates the Unity canvas and UI; it does not execute arbitrary Yarn instructions, gameplay code, battle transitions or other custom commands. Unsupported commands are retained and identified. Backgrounds stretch to the stage like the current Unity background controller. Native text layout/fonts and engine rendering can still differ.
- Browser audio needs user interaction and a supported uploaded audio format. Merely selecting a line does not play sound.
- JSON backup includes scenario text, not binary assets. Restoring a backup opens it only in the current page and never marks the editor as connected.
- The endpoint is fixed to the user-provided spreadsheet; no private scenario content is committed to GitHub. Authentication details and backup behavior are in [the backend guide](apps-script/DEPLOY.md).

Official deployment references: [Vite on GitHub Pages](https://vite.dev/guide/static-deploy.html#github-pages), [Apps Script Web Apps](https://developers.google.com/apps-script/guides/web).
