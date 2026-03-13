# SRS Scheduled Rereading App (Prototype)

Single-page prototype implementing:
- Study Queue
- Sources list
- Source Portal
- Settings shell

## Run

```bash
python3 -m http.server 4173
```

Open http://localhost:4173

## Optional: pypdf bookmark parser (recommended)

For best hierarchy extraction, run the local pypdf parser service:

```bash
pip install pypdf
python3 pypdf_outline_server.py --port 4174
```

Then set endpoint once in browser devtools:

```js
localStorage.setItem('srs-pypdf-endpoint', 'http://localhost:4174/api/parse-pdf-outline')
```

The app will then parse chapters/sections from PDF bookmarks via pypdf first, and fall back to pdf.js outline/text heuristics if unavailable.

## Notes
- The app starts with **no default sources**.
- Use **Sources → Add Source** to import your own PDF/YouTube/local video sources.
- The import modal now supports **drag-and-drop** file upload.
- Dropped PDFs are automatically scanned in-browser for likely section headers, then those headers seed the outline and review units.
- Uploaded PDF/local video files are stored in browser IndexedDB and remain available until deleted from the UI.
- If parsing cannot detect enough headers, the app falls back to a default section template.
- State is persisted in `localStorage`.
