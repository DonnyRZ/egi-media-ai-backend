"""Persistent HTTP scorer for the frozen IT v4 industry prefilter.

Keeps Qwen 0.6B warm on CPU. Does not retune thresholds or call OpenAI.
"""
from __future__ import annotations

import hashlib
import json
import os
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

os.environ.setdefault("HF_HUB_OFFLINE", "1")
os.environ.setdefault("TRANSFORMERS_OFFLINE", "1")
os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT / "python") not in sys.path:
    sys.path.insert(0, str(ROOT / "python"))

from qwen_cpu_embed_local import MODEL_ID, REVISION  # noqa: E402
from score_it_v4 import MODEL_VERSION, load_bundle, load_inference_stats, load_thresholds, score_one  # noqa: E402

HOST = os.environ.get("IT_V4_SCORER_HOST") or ("0.0.0.0" if os.environ.get("PORT") else "127.0.0.1")
PORT = int(os.environ.get("PORT") or os.environ.get("IT_V4_SCORER_PORT", "8091"))
MAX_LENGTH = 512
DIM = 1024
LOAD_LOCK = threading.Lock()
LOAD_ERROR: str | None = None


def title_summary_text(title: str, summary: str) -> str:
    return "Title: {}\nSummary: {}\nContent: ".format(title or "", summary or "")


class ItV4Scorer:
    def __init__(self) -> None:
        import numpy as np
        from sentence_transformers import SentenceTransformer

        self.np = np
        self.bundle = load_bundle()
        self.stats = load_inference_stats()
        self.t1, self.t2 = load_thresholds(self.bundle)
        model_path = ROOT / "data" / "industry-relevance-qwen-v1" / "model" / "qwen3-embedding-0.6b"
        self.model = SentenceTransformer(str(model_path), device="cpu", trust_remote_code=True, local_files_only=True)
        self.model.max_seq_length = MAX_LENGTH
        self.cache: dict[str, object] = {}

    def embed(self, title: str, summary: str):
        encoded = title_summary_text(title, summary)
        digest = hashlib.sha256(encoded.encode("utf-8")).hexdigest()
        cached = self.cache.get(digest)
        if cached is not None:
            return digest, cached
        vector = self.model.encode(
            [encoded],
            batch_size=1,
            convert_to_numpy=True,
            normalize_embeddings=True,
            show_progress_bar=False,
        )[0].astype(self.np.float32)
        if vector.shape != (DIM,):
            raise RuntimeError(f"unexpected embedding dim {vector.shape}")
        self.cache[digest] = vector
        return digest, vector

    def score(self, title: str, summary: str, content: str = "") -> dict:
        del content
        digest, vector = self.embed(title, summary)
        result = score_one(
            {"article_id": 0, "title": title or "", "summary": summary or ""},
            vector,
            bundle=self.bundle,
            stats=self.stats,
        )
        result.pop("article_id", None)
        result["input_sha256"] = digest
        result["embedding_model_id"] = MODEL_ID
        result["embedding_revision"] = REVISION
        return result

    def health(self) -> dict:
        return {
            "ok": True,
            "model_version": MODEL_VERSION,
            "stage1_threshold": self.t1,
            "stage2_threshold": self.t2,
            "cache_size": len(self.cache),
        }


SCORER: ItV4Scorer | None = None


def scorer() -> ItV4Scorer:
    global SCORER, LOAD_ERROR
    with LOAD_LOCK:
        if SCORER is not None:
            return SCORER
        if LOAD_ERROR:
            raise RuntimeError(LOAD_ERROR)
        try:
            SCORER = ItV4Scorer()
            return SCORER
        except Exception as error:  # noqa: BLE001
            LOAD_ERROR = str(error)[:300]
            raise


class Handler(BaseHTTPRequestHandler):
    def log_message(self, format: str, *args) -> None:  # noqa: A003
        sys.stderr.write("%s - %s\n" % (self.address_string(), format % args))

    def _json(self, code: int, payload: dict) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:  # noqa: N802
        if self.path.rstrip("/") != "/health":
            self._json(404, {"ok": False, "error": "not_found"})
            return
        if SCORER is None:
            self._json(503, {"ok": False, "error": LOAD_ERROR or "loading"})
            return
        try:
            self._json(200, SCORER.health())
        except Exception as error:  # noqa: BLE001
            self._json(503, {"ok": False, "error": str(error)[:300]})

    def do_POST(self) -> None:  # noqa: N802
        if self.path.rstrip("/") != "/score":
            self._json(404, {"ok": False, "error": "not_found"})
            return
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0 or length > 2_000_000:
            self._json(400, {"ok": False, "error": "invalid_body"})
            return
        try:
            payload = json.loads(self.rfile.read(length).decode("utf-8"))
        except (json.JSONDecodeError, UnicodeDecodeError):
            self._json(400, {"ok": False, "error": "invalid_json"})
            return
        if not isinstance(payload, dict):
            self._json(400, {"ok": False, "error": "invalid_json"})
            return
        try:
            result = scorer().score(
                str(payload.get("title") or ""),
                str(payload.get("summary") or ""),
                str(payload.get("content") or payload.get("body") or ""),
            )
            self._json(200, result)
        except Exception as error:  # noqa: BLE001
            self._json(500, {"ok": False, "error": str(error)[:300]})


def main() -> int:
    threading.Thread(target=scorer, daemon=True).start()
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    print(json.dumps({"status": "listening", "host": HOST, "port": PORT, "model_version": MODEL_VERSION}))
    server.serve_forever()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
