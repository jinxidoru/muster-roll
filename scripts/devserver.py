#!/usr/bin/env python3
"""Local dev server with no-store caching + live reload.

Plain `python3 -m http.server` sends no cache headers, so browsers reuse stale
ES modules between edits (confusing "missing export" errors), and it never
reloads on change. This server:
  - sends `Cache-Control: no-store` on everything,
  - exposes `/__version` (a token derived from repo file mtimes), and
  - injects a tiny poller into every HTML page that reloads when that changes.

    python3 scripts/devserver.py          # http://localhost:8000
    python3 scripts/devserver.py 8080     # a different port

Dev only; production is served by GitHub Pages.
"""
import http.server
import os
import sys
from pathlib import Path

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
ROOT = Path(__file__).resolve().parent.parent  # repo root
SKIP = {".git", ".claude", "data", "node_modules", "build", "staging"}

LIVERELOAD = (
    "<script>(function(){let v=null;async function t(){try{"
    "const r=await fetch('/__version',{cache:'no-store'});const n=await r.text();"
    "if(v===null)v=n;else if(n!==v){location.reload();return;}}catch(e){}"
    "setTimeout(t,1000);}t();})();</script>"
)


def version_token():
    """A token that changes whenever a watched file is added/removed/edited."""
    count = 0
    newest = 0.0
    for dirpath, dirnames, filenames in os.walk(ROOT):
        dirnames[:] = [d for d in dirnames if d not in SKIP and not d.startswith(".")]
        for name in filenames:
            try:
                m = os.path.getmtime(os.path.join(dirpath, name))
            except OSError:
                continue
            count += 1
            if m > newest:
                newest = m
    return f"{count}:{newest:.3f}"


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store, max-age=0")
        super().end_headers()

    def _send_bytes(self, data, content_type):
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(data)

    def do_GET(self):
        if self.path.split("?")[0] == "/__version":
            self._send_bytes(version_token().encode(), "text/plain; charset=utf-8")
            return
        # Inject the live-reload poller into HTML pages.
        path = self.translate_path(self.path)
        if os.path.isdir(path):
            path = os.path.join(path, "index.html")
        if path.endswith(".html") and os.path.isfile(path):
            with open(path, "rb") as f:
                data = f.read()
            snippet = LIVERELOAD.encode()
            data = data.replace(b"</body>", snippet + b"</body>", 1) if b"</body>" in data else data + snippet
            self._send_bytes(data, "text/html; charset=utf-8")
            return
        super().do_GET()


def main():
    http.server.ThreadingHTTPServer.allow_reuse_address = True
    with http.server.ThreadingHTTPServer(("", PORT), Handler) as httpd:
        print(f"Muster Roll dev server (no-store + live reload) → http://localhost:{PORT}")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            pass


if __name__ == "__main__":
    main()
