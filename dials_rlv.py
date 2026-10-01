#!/usr/bin/env python3
"""Open DIALS .expt/.refl files in the RLV reciprocal lattice viewer.

Starts a small local web server that serves the RLV viewer page and the
given files, then opens the viewer in your web browser:

    python3 dials_rlv.py indexed.expt indexed.refl
    python3 dials_rlv.py a.expt a.refl b.expt b.refl      # several datasets

Files are paired in order: the 1st .expt with the 1st .refl, and so on.

On a remote machine (e.g. over SSH) no browser is opened. Instead the
script prints an `ssh -L` command to run on your own computer, which
forwards the port, and a link to open there. The viewer then runs on
your computer; only the data files travel over the SSH connection.

Safety:
  - The server only listens on this machine (127.0.0.1), not the network.
  - Only the files named on the command line are served.
  - Every request needs a random access token, which is in the printed
    link. Other users on a shared machine cannot read your files without
    it, and neither can other web pages open in your browser.

The viewer page (rlv.html) is looked for, in this order:
  1. --html PATH
  2. the RLV_HTML environment variable
  3. rlv.html next to this script
  4. rlv_html/dist/index.html next to this script (a built repo checkout)
  5. a cached download in ~/.cache/rlv/rlv.html
  6. downloaded from the latest RLV release (then cached)

Only the Python standard library is used.
"""

import argparse
import getpass
import http.cookies
import os
import secrets
import shutil
import socket
import sys
import threading
import urllib.parse
import urllib.request
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

# Where to download the viewer page if no local copy is found.
RELEASE_URL = "https://github.com/mpks/rlv/releases/latest/download/rlv.html"
CACHE_FILE = Path.home() / ".cache" / "rlv" / "rlv.html"

DEFAULT_PORT = 8765
TOKEN_COOKIE = "rlv_token"


# ── Finding the viewer page ──────────────────────────────────────────

def find_viewer_html(cli_path):
    here = Path(__file__).resolve().parent
    candidates = [
        cli_path,
        os.environ.get("RLV_HTML"),
        here / "rlv.html",
        here / "rlv_html" / "dist" / "index.html",
        CACHE_FILE,
    ]
    for c in candidates:
        if c and Path(c).is_file():
            return Path(c)
    return download_viewer()


def download_viewer():
    print(f"Downloading the RLV viewer from {RELEASE_URL} ...")
    try:
        with urllib.request.urlopen(RELEASE_URL, timeout=30) as r:
            data = r.read()
    except Exception as e:  # noqa: BLE001
        sys.exit(
            f"Could not download the viewer ({e}).\n"
            "Download rlv.html from the RLV releases page and pass it with "
            "--html, or put it next to this script."
        )
    CACHE_FILE.parent.mkdir(parents=True, exist_ok=True)
    CACHE_FILE.write_bytes(data)
    print(f"Saved to {CACHE_FILE}")
    return CACHE_FILE


# ── Command line ─────────────────────────────────────────────────────

def parse_args():
    p = argparse.ArgumentParser(
        description="Open DIALS .expt/.refl files in the RLV viewer.",
        epilog="Example: python3 dials_rlv.py indexed.expt indexed.refl",
    )
    p.add_argument("files", nargs="+", metavar="FILE",
                   help=".expt and .refl files (paired in order)")
    p.add_argument("--port", type=int, default=DEFAULT_PORT,
                   help=f"port to use (default {DEFAULT_PORT}; "
                        "a free one is chosen if it is busy)")
    p.add_argument("--html", metavar="PATH",
                   help="viewer page to serve (default: see --help text)")
    p.add_argument("--no-browser", action="store_true",
                   help="do not open a browser, just print the link")
    args = p.parse_args()

    expts, refls = [], []
    for f in args.files:
        path = Path(f).expanduser().resolve()
        if not path.is_file():
            p.error(f"file not found: {f}")
        if path.suffix == ".expt":
            expts.append(path)
        elif path.suffix == ".refl":
            refls.append(path)
        else:
            p.error(f"not an .expt or .refl file: {f}")
    if not expts or len(expts) != len(refls):
        p.error(f"need matching pairs: got {len(expts)} .expt and "
                f"{len(refls)} .refl file(s)")
    args.pairs = list(zip(expts, refls))
    return args


# ── Web server ───────────────────────────────────────────────────────

def make_handler(viewer_html, files, token):
    """files: dict mapping URL path ('/files/0/x.expt') -> Path on disk."""

    class Handler(BaseHTTPRequestHandler):
        server_version = "RLV"

        def do_GET(self):
            url = urllib.parse.urlsplit(self.path)

            # Only accept requests addressed to this machine by name. This
            # blocks "DNS rebinding", where a web page tricks the browser
            # into treating its own site name as 127.0.0.1.
            host = (self.headers.get("Host") or "").rsplit(":", 1)[0]
            if host not in ("localhost", "127.0.0.1", "[::1]"):
                return self.send_error(403, "Forbidden host")

            # Token: from the link (?token=...) or, for the follow-up
            # requests the page makes, from a cookie set on the first visit.
            query = urllib.parse.parse_qs(url.query)
            cookie = http.cookies.SimpleCookie(self.headers.get("Cookie", ""))
            given = (query.get("token", [None])[0]
                     or (cookie[TOKEN_COOKIE].value
                         if TOKEN_COOKIE in cookie else None))
            if not given or not secrets.compare_digest(given, token):
                return self.send_error(
                    403, "Missing or wrong token - use the link printed "
                         "by dials_rlv.py")

            if url.path in ("/", "/index.html"):
                return self.send_file(viewer_html, "text/html; charset=utf-8",
                                      set_cookie=True)
            if url.path in files:
                return self.send_file(files[url.path],
                                      "application/octet-stream")
            return self.send_error(404, "Not found")

        def send_file(self, path, content_type, set_cookie=False):
            try:
                f = open(path, "rb")
            except OSError as e:
                return self.send_error(500, f"Cannot read file: {e}")
            with f:
                self.send_response(200)
                self.send_header("Content-Type", content_type)
                self.send_header("Content-Length",
                                 str(os.fstat(f.fileno()).st_size))
                self.send_header("Cache-Control", "no-store")
                if set_cookie:
                    self.send_header(
                        "Set-Cookie",
                        f"{TOKEN_COOKIE}={token}; Path=/; HttpOnly; "
                        "SameSite=Strict")
                self.end_headers()
                try:
                    shutil.copyfileobj(f, self.wfile)
                except (BrokenPipeError, ConnectionResetError):
                    pass  # browser closed the connection

        def log_message(self, fmt, *args):
            pass  # keep the terminal quiet

    return Handler


def start_server(handler, port):
    """Listen on 127.0.0.1:port, or on any free port if that one is busy."""
    try:
        return ThreadingHTTPServer(("127.0.0.1", port), handler)
    except OSError:
        print(f"Port {port} is in use; choosing a free one.")
        return ThreadingHTTPServer(("127.0.0.1", 0), handler)


# ── Remote or local? ─────────────────────────────────────────────────

def is_remote_session():
    """True if we are probably on a machine without the user's screen."""
    if os.environ.get("SSH_CONNECTION") or os.environ.get("SSH_CLIENT"):
        return True
    if sys.platform.startswith("linux"):
        return not (os.environ.get("DISPLAY")
                    or os.environ.get("WAYLAND_DISPLAY"))
    return False


# ── Main ─────────────────────────────────────────────────────────────

def main():
    args = parse_args()
    viewer_html = find_viewer_html(args.html)
    token = secrets.token_urlsafe(16)

    # Serve each file under /files/<n>/<name>, and build the viewer link.
    files, query = {}, [("token", token)]
    n = 0
    for expt, refl in args.pairs:
        for kind, path in (("expt", expt), ("refl", refl)):
            url_path = f"/files/{n}/{urllib.parse.quote(path.name)}"
            files[url_path] = path
            query.append((kind, url_path))
            n += 1

    server = start_server(make_handler(viewer_html, files, token), args.port)
    port = server.server_address[1]
    link = (f"http://localhost:{port}/?"
            + urllib.parse.urlencode(query))

    print(f"Serving the RLV viewer with {len(args.pairs)} dataset(s):")
    for expt, refl in args.pairs:
        print(f"  {expt}\n  {refl}")
    print()

    if is_remote_session():
        user = getpass.getuser()
        host = socket.getfqdn()
        if host.startswith("localhost"):
            host = socket.gethostname()
        print("This looks like a remote session. On your own computer, run:")
        print(f"\n    ssh -N -L {port}:localhost:{port} {user}@{host}\n")
        print("(add any options you normally use with ssh, e.g. a jump host),")
        print("then open this link in your browser:")
        print(f"\n    {link}\n")
    else:
        print(f"Opening:\n\n    {link}\n")
        if not args.no_browser:
            threading.Timer(0.5, webbrowser.open, [link]).start()

    print("Press Ctrl+C to stop.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
