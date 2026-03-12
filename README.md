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
- Imported sources are auto-parsed into sample outline + atomic review units for queue/testing.
- State is persisted in `localStorage`.
