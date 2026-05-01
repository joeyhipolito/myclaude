---
produced_by: devops-engineer
phase: phase-5
workspace: 20260501-2c3ddc14
created_at: "2026-05-01T10:24:01Z"
confidence: high
depends_on:
  []
token_estimate: 420
---

# MyClaude

A local, in-browser dashboard that aggregates your Claude conversation history from exported data — no server, no account, no upload.

<!-- screenshot placeholder -->
> **Screenshot:** _(add a screenshot of the dashboard here)_

---

## What it is

MyClaude reads Claude conversation exports from your local file system and renders them as a searchable, filterable dashboard. Everything runs inside the browser tab — the page never makes a network request with your data.

## How to run

**Requirements:**
- A Chromium-based browser (Chrome, Edge, Arc, Brave) — required for the File System Access API
- Python 3 (for the local dev server)

```bash
git clone <repo-url>
cd myclaude
make serve
```

`make serve` starts `python3 -m http.server 8000` inside `web/` and opens `http://localhost:8000` in your default browser.

To stop the server: `kill $(lsof -ti:8000)`

### Other commands

| Command | What it does |
|---|---|
| `make serve` | Start local dev server + open browser |
| `make tidy` | Run lint checks on JS/HTML sources |
| `make package` | Zip `web/` into `output/` for static hosting |

## Browser requirements

The File System Access API is required to read files from your local disk without uploading them. This API is only available in **Chromium-based browsers** (Chrome 86+, Edge 86+, Arc, Brave).

Firefox and Safari do not support `window.showDirectoryPicker()` as of mid-2026. The app will show a warning if you open it in an unsupported browser.

## How the aggregator works

1. You click **Open Folder** and select your Claude export directory.
2. The browser calls `showDirectoryPicker()` — you grant read-only access to that folder.
3. The aggregator walks the directory tree, finds all `conversations.json` files, and parses them entirely in memory.
4. Parsed conversations are indexed by date, project, and word count, then handed to the dashboard renderer.
5. No data leaves the browser tab at any point.

## Privacy

**Everything stays in your browser.** MyClaude has no backend, no analytics, no telemetry, and makes zero outbound network requests after the page loads. Your conversation data never leaves your machine. You can verify this by opening DevTools → Network tab — it will be empty while you use the app.
