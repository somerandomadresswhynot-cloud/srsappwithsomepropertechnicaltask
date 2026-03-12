#!/usr/bin/env python3
"""Small local API for parsing PDF bookmarks with pypdf.

Run: python3 pypdf_outline_server.py --port 4174
Then in browser console (once):
  localStorage.setItem('srs-pypdf-endpoint', 'http://localhost:4174/api/parse-pdf-outline')
"""

from __future__ import annotations

import argparse
import cgi
import json
from http.server import BaseHTTPRequestHandler, HTTPServer
from io import BytesIO
from typing import Any

from pypdf import PdfReader


def _coerce_outline_items(items: list[Any], depth: int = 0) -> list[dict[str, Any]]:
    result: list[dict[str, Any]] = []
    for item in items:
        if isinstance(item, list):
            result.extend(_coerce_outline_items(item, min(depth + 1, 6)))
            continue

        title = str(getattr(item, "title", "") or "").strip()
        if not title:
            continue

        try:
            page_start = int(item.page_number) + 1
        except Exception:
            page_start = None

        if page_start is None or page_start <= 0:
            continue

        result.append({"title": title, "pageStart": page_start, "level": min(depth, 6)})
    return result


class Handler(BaseHTTPRequestHandler):
    def _cors(self) -> None:
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def do_OPTIONS(self) -> None:  # noqa: N802
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_POST(self) -> None:  # noqa: N802
        if self.path != "/api/parse-pdf-outline":
            self.send_response(404)
            self._cors()
            self.end_headers()
            return

        form = cgi.FieldStorage(
            fp=self.rfile,
            headers=self.headers,
            environ={"REQUEST_METHOD": "POST", "CONTENT_TYPE": self.headers.get("Content-Type", "")},
        )

        if "file" not in form:
            self._json({"sections": [], "error": "missing file"}, status=400)
            return

        file_item = form["file"]
        file_bytes = file_item.file.read() if file_item.file else b""
        if not file_bytes:
            self._json({"sections": [], "error": "empty file"}, status=400)
            return

        try:
            reader = PdfReader(BytesIO(file_bytes))
            outline = reader.outline or []
            sections = _coerce_outline_items(outline)
            sections.sort(key=lambda x: (x["pageStart"], x["level"]))
            self._json({"sections": sections[:200]})
        except Exception as exc:  # noqa: BLE001
            self._json({"sections": [], "error": str(exc)}, status=200)

    def _json(self, data: dict[str, Any], status: int = 200) -> None:
        payload = json.dumps(data).encode("utf-8")
        self.send_response(status)
        self._cors()
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default="0.0.0.0")
    parser.add_argument("--port", type=int, default=4174)
    args = parser.parse_args()

    server = HTTPServer((args.host, args.port), Handler)
    print(f"Serving pypdf outline parser on http://{args.host}:{args.port}")
    server.serve_forever()


if __name__ == "__main__":
    main()
