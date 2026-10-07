import argparse
from contextlib import closing
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
import math
from pathlib import Path
import re
import sqlite3
from urllib.parse import parse_qs, urlsplit


PROJECT_ROOT = Path(__file__).resolve().parents[1]
MAX_BODY = 256 * 1024
CACHED_TEXTBOOK_PATH = "/assets/textbooks/sciences-practical-guide-hodder-2014-teacher-book.pdf"


def validate_key(key):
    if not isinstance(key, str) or not re.fullmatch(r"(?:page:/[a-zA-Z0-9/_-]{0,150}|q(?:0[1-9]|[1-3][0-9]|40):page-(?:0[1-9]|[1-3][0-9]|4[01]))", key):
        raise ValueError("Invalid annotation key")
    return key


def validate_stroke(stroke):
    if not isinstance(stroke, dict):
        raise ValueError("Invalid stroke")
    if not isinstance(stroke.get("id"), str) or not re.fullmatch(r"[a-zA-Z0-9-]{8,80}", stroke["id"]):
        raise ValueError("Invalid stroke ID")
    if stroke.get("tool") not in ("pen", "eraser"):
        raise ValueError("Invalid tool")
    if not isinstance(stroke.get("color"), str) or not re.fullmatch(r"#[0-9a-fA-F]{6}", stroke["color"]):
        raise ValueError("Invalid color")
    width = stroke.get("width")
    if type(width) not in (int, float) or not math.isfinite(width) or not 0 < width <= 0.1:
        raise ValueError("Invalid width")
    points = stroke.get("points")
    anchor = stroke.get("anchor")
    if anchor is not None and (not isinstance(anchor, str) or not re.fullmatch(r"[a-zA-Z0-9:-]{1,80}", anchor)):
        raise ValueError("Invalid anchor")
    if not isinstance(points, list) or not 1 <= len(points) <= 4096:
        raise ValueError("Invalid points")
    for point in points:
        if not isinstance(point, list) or len(point) != 2:
            raise ValueError("Invalid point")
        limit = (-100, 100) if anchor is not None else (0, 1)
        if any(type(value) not in (int, float) or not math.isfinite(value) or not limit[0] <= value <= limit[1] for value in point):
            raise ValueError("Point outside annotation bounds")
    result = {field: stroke[field] for field in ("id", "tool", "color", "width", "points")}
    if anchor is not None:
        result["anchor"] = anchor
    return result


class AnnotationStore:
    def __init__(self, path):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with closing(sqlite3.connect(self.path)) as connection, connection:
            connection.execute("CREATE TABLE IF NOT EXISTS annotations (key TEXT PRIMARY KEY, state TEXT NOT NULL)")

    def read(self, key):
        validate_key(key)
        with closing(sqlite3.connect(self.path)) as connection:
            row = connection.execute("SELECT state FROM annotations WHERE key = ?", (key,)).fetchone()
        return json.loads(row[0]) if row else {"revision": 0, "generation": 0, "strokes": []}

    def apply(self, key, operation):
        validate_key(key)
        if not isinstance(operation, dict) or operation.get("action") not in ("add", "remove", "clear"):
            raise ValueError("Invalid operation")
        action = operation["action"]
        stroke = validate_stroke(operation.get("stroke")) if action == "add" else None
        if action == "remove" and not isinstance(operation.get("id"), str):
            raise ValueError("Invalid stroke ID")
        with closing(sqlite3.connect(self.path, timeout=10)) as connection, connection:
            connection.execute("BEGIN IMMEDIATE")
            row = connection.execute("SELECT state FROM annotations WHERE key = ?", (key,)).fetchone()
            state = json.loads(row[0]) if row else {"revision": 0, "generation": 0, "strokes": []}
            if operation.get("generation") != state["generation"]:
                return 409, state
            if action == "clear":
                if operation.get("revision") != state["revision"]:
                    return 409, state
                state["strokes"] = []
                state["generation"] += 1
            elif action == "add":
                if any(saved["id"] == stroke["id"] for saved in state["strokes"]):
                    return 200, state
                if len(state["strokes"]) >= 2000:
                    raise ValueError("Too many strokes; clear annotations first")
                state["strokes"].append(stroke)
            else:
                state["strokes"] = [saved for saved in state["strokes"] if saved["id"] != operation["id"]]
            state["revision"] += 1
            connection.execute(
                "INSERT INTO annotations VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET state = excluded.state",
                (key, json.dumps(state, separators=(",", ":"))),
            )
        return 200, state


class AnnotationHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, store, directory, **kwargs):
        self.store = store
        super().__init__(*args, directory=directory, **kwargs)

    def end_headers(self):
        if urlsplit(self.path).path == CACHED_TEXTBOOK_PATH:
            self.send_header("Cache-Control", "public, max-age=86400")
        super().end_headers()

    def reply(self, status, data):
        body = json.dumps(data, separators=(",", ":")).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        parsed = urlsplit(self.path)
        if parsed.path == "/api/annotations":
            try:
                self.reply(200, self.store.read(parse_qs(parsed.query).get("key", [""])[0]))
            except ValueError as error:
                self.reply(400, {"error": str(error)})
            return
        if parsed.path.startswith("/api/"):
            self.reply(404, {"error": "Unknown endpoint"})
            return
        super().do_GET()

    def do_POST(self):
        if urlsplit(self.path).path != "/api/annotations":
            self.reply(404, {"error": "Unknown endpoint"})
            return
        origin = self.headers.get("Origin")
        if (origin and urlsplit(origin).netloc != self.headers.get("Host")) or self.headers.get("Sec-Fetch-Site") == "cross-site":
            self.reply(403, {"error": "Cross-origin writes are not allowed"})
            return
        if self.headers.get("Content-Type", "").split(";")[0] != "application/json":
            self.reply(415, {"error": "Expected application/json"})
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if not 0 < length <= MAX_BODY:
                self.reply(413, {"error": "Invalid request size"})
                return
            payload = json.loads(self.rfile.read(length))
            if not isinstance(payload, dict):
                raise ValueError("Invalid request")
            status, state = self.store.apply(payload.get("key"), payload)
            self.reply(status, state)
        except (ValueError, TypeError) as error:
            self.reply(400, {"error": str(error)})
        except sqlite3.Error:
            self.reply(503, {"error": "Annotation storage unavailable"})


def main():
    parser = argparse.ArgumentParser(description="Serve MkDocs with shared page annotations")
    parser.add_argument("--bind", default="127.0.0.1")
    parser.add_argument("--port", default=8000, type=int)
    parser.add_argument("--data", type=Path, default=PROJECT_ROOT / "data" / "annotations.sqlite3")
    arguments = parser.parse_args()
    site = PROJECT_ROOT / "site"
    if not (site / "index.html").is_file():
        parser.error("Build the site with mkdocs build --strict first")
    store = AnnotationStore(arguments.data)
    handler = partial(AnnotationHandler, store=store, directory=str(site))
    with ThreadingHTTPServer((arguments.bind, arguments.port), handler) as server:
        print(f"Annotation server: http://{arguments.bind}:{arguments.port} | Database: {arguments.data}", flush=True)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass


if __name__ == "__main__":
    main()