from concurrent.futures import ThreadPoolExecutor
from functools import partial
from http.server import ThreadingHTTPServer
import json
from pathlib import Path
import tempfile
import threading
import unittest
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from scripts.annotation_server import AnnotationHandler, AnnotationStore


def make_stroke(identifier="stroke-0001"):
    return {"id": identifier, "tool": "pen", "color": "#dd3333", "width": 0.005, "points": [[0.2, 0.3], [0.4, 0.5]]}


class AnnotationTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.path = Path(self.temporary.name) / "annotations.sqlite3"
        self.store = AnnotationStore(self.path)
        self.key = "q18:page-18"

    def tearDown(self):
        self.temporary.cleanup()

    def add(self, identifier="stroke-0001", generation=0):
        return self.store.apply(self.key, {"action": "add", "generation": generation, "stroke": make_stroke(identifier)})

    def test_persistence_and_question_isolation(self):
        self.add()
        self.assertEqual(len(AnnotationStore(self.path).read(self.key)["strokes"]), 1)
        self.assertEqual(self.store.read("q19:page-19")["strokes"], [])

    def test_concurrent_adds_do_not_overwrite(self):
        with ThreadPoolExecutor(max_workers=8) as executor:
            list(executor.map(lambda number: self.add(f"stroke-{number:04}"), range(20)))
        self.assertEqual(len(self.store.read(self.key)["strokes"]), 20)

    def test_repeated_add_is_idempotent(self):
        self.add()
        self.add()
        self.assertEqual(self.store.read(self.key)["revision"], 1)

    def test_full_page_anchors_and_page_isolation(self):
        stroke = make_stroke()
        stroke.update(anchor="block:12", points=[[0.2, -0.5], [0.4, 2.5]])
        key = "page:/questions/q18/"
        status, state = self.store.apply(key, {"action": "add", "generation": 0, "stroke": stroke})
        self.assertEqual(status, 200)
        self.assertEqual(state["strokes"][0]["anchor"], "block:12")
        self.assertEqual(AnnotationStore(self.path).read(key)["strokes"][0]["points"], stroke["points"])
        self.assertEqual(self.store.read("page:/knowledge-map/")["strokes"], [])
        self.assertEqual(self.store.read("page:/")["strokes"], [])
        stroke["anchor"] = "invalid/anchor"
        with self.assertRaises(ValueError):
            self.store.apply(key, {"action": "add", "generation": 0, "stroke": stroke})

    def test_remove_preserves_other_clients_strokes(self):
        self.add()
        self.add("stroke-0002")
        self.store.apply(self.key, {"action": "remove", "generation": 0, "id": "stroke-0001"})
        self.assertEqual([stroke["id"] for stroke in self.store.read(self.key)["strokes"]], ["stroke-0002"])

    def test_clear_rejects_stale_revision_and_stale_draws(self):
        self.add()
        self.assertEqual(self.store.apply(self.key, {"action": "clear", "generation": 0, "revision": 0})[0], 409)
        self.assertEqual(self.store.apply(self.key, {"action": "clear", "generation": 0, "revision": 1})[0], 200)
        self.assertEqual(self.add("stroke-0002")[0], 409)
        self.assertEqual(self.add("stroke-0003", generation=1)[0], 200)

    def test_invalid_inputs(self):
        for points in ([[float("nan"), 0]], [[2, 0]], [], [[True, 0]]):
            stroke = make_stroke()
            stroke["points"] = points
            with self.assertRaises(ValueError):
                self.store.apply(self.key, {"action": "add", "generation": 0, "stroke": stroke})
        with self.assertRaises(ValueError):
            self.store.read("../../data/annotations.sqlite3")

    def test_http_sync_static_serving_and_origin_protection(self):
        handler = partial(AnnotationHandler, store=self.store, directory=self.temporary.name)
        textbook = Path(self.temporary.name) / "assets" / "textbooks" / "sciences-practical-guide-hodder-2014-teacher-book.pdf"
        textbook.parent.mkdir(parents=True)
        textbook.write_bytes(b"%PDF-test")
        server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
        worker = threading.Thread(target=server.serve_forever, daemon=True)
        worker.start()
        base = f"http://127.0.0.1:{server.server_port}"
        try:
            body = json.dumps({"key": self.key, "action": "add", "generation": 0, "stroke": make_stroke()}).encode()
            request = Request(base + "/api/annotations", data=body, headers={"Content-Type": "application/json"})
            with urlopen(request) as response:
                self.assertEqual(response.status, 200)
            with urlopen(base + "/api/annotations?key=" + self.key) as response:
                self.assertEqual(len(json.load(response)["strokes"]), 1)
                self.assertEqual(response.headers.get("Cache-Control"), "no-store")
            request.add_header("Origin", "http://untrusted.example")
            with self.assertRaises(HTTPError) as caught:
                urlopen(request)
            self.assertEqual(caught.exception.code, 403)
            with urlopen(base + "/") as response:
                self.assertEqual(response.status, 200)
                self.assertIsNone(response.headers.get("Cache-Control"))
            with urlopen(base + "/assets/textbooks/sciences-practical-guide-hodder-2014-teacher-book.pdf") as response:
                self.assertEqual(response.headers.get("Cache-Control"), "public, max-age=86400")
        finally:
            server.shutdown()
            server.server_close()
            worker.join()


if __name__ == "__main__":
    unittest.main()