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

## Notes
- The app starts with **no default sources**.
- Use **Sources → Add Source** to import your own PDF/YouTube/local video metadata.
- The import modal now supports **drag-and-drop** file upload.
- Dropped PDFs are automatically scanned in-browser for likely section headers, then those headers seed the outline and review units.
- If parsing cannot detect enough headers, the app falls back to a default section template.
- State is persisted in `localStorage`.
