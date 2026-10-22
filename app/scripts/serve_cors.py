#!/usr/bin/env python3
"""Serve the current directory over HTTP with a CORS header.

Like `python3 -m http.server`, but adds `Access-Control-Allow-Origin: *`
so a page on another origin (e.g. https://mpks.github.io/rlv/) is allowed
to read the files. For local testing and demos only.

Usage:
    cd /path/to/data
    python3 /path/to/serve_cors.py [port]        # default 8000

Then open:
    https://mpks.github.io/rlv/?expt=http://localhost:8000/refined.expt&refl=http://localhost:8000/refined.refl
"""

import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer


class CORSHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        super().end_headers()


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    # Bind to localhost only, so the files are not visible to other machines.
    server = ThreadingHTTPServer(("127.0.0.1", port), CORSHandler)
    print(f"Serving {__import__('os').getcwd()} at http://localhost:{port}/ (Ctrl+C to stop)")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
