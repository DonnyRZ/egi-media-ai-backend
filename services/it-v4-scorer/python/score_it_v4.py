"""IT v4 frozen industry prefilter scorer.

Uses fit-corpus BM25 IDF and min-max from it-v4.inference.json.
Does not retune thresholds, overwrite v1 it.joblib, hospitality, or test.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import joblib
import numpy as np

from train_it_v3 import IT_TERMS, metric, text, tokens
from train_it_v4 import is_lexical, matrix_for

ROOT = Path(__file__).resolve().parents[1]
V4 = ROOT / "data" / "industry-relevance-qwen-v1" / "it-v4"
JOBLIB = V4 / "model" / "it-v4.joblib"
INFERENCE = V4 / "model" / "it-v4.inference.json"
FREEZE = V4 / "audits" / "product-freeze.json"
FIXTURES = V4 / "audits" / "inference-fixtures.json"
MODEL_VERSION = "it-v4"


def load_inference_stats(path: Path = INFERENCE) -> dict:
    if not path.exists():
        raise FileNotFoundError(f"missing frozen inference stats: {path}")
    return json.loads(path.read_text(encoding="utf-8"))


def load_bundle(path: Path = JOBLIB) -> dict:
    if not path.exists():
        raise FileNotFoundError(f"missing it-v4.joblib: {path}")
    return joblib.load(path)


def load_thresholds(bundle: dict | None = None, freeze_path: Path = FREEZE) -> tuple[float, float]:
    if freeze_path.exists():
        freeze = json.loads(freeze_path.read_text(encoding="utf-8"))
        return float(freeze["stage1_threshold"]), float(freeze["stage2_threshold"])
    artifact = (bundle or {}).get("artifact") or {}
    return float(artifact["stage1_threshold"]), float(artifact["stage2_threshold"])


def bm25_scores_frozen(documents: list[str], stats: dict) -> np.ndarray:
    docs = [tokens(d) for d in documents]
    n = int(stats["n"])
    avgdl = float(stats["avgdl"])
    df = {str(key): int(value) for key, value in stats["df"].items()}
    query_terms = list(stats.get("query_terms") or IT_TERMS)
    scores = np.zeros(len(docs), dtype=np.float32)
    for i, doc in enumerate(docs):
        counts = {term: doc.count(term) for term in set(doc)}
        for term in query_terms:
            if term not in counts:
                continue
            idf = np.log(1 + (n - df.get(term, 0) + 0.5) / (df.get(term, 0) + 0.5))
            tf = counts[term]
            scores[i] += idf * (tf * 2.0) / (tf + 1.2 * (0.25 + 0.75 * len(doc) / max(avgdl, 1.0)))
    return scores


def normalize_frozen(values: np.ndarray, lo: float, hi: float) -> np.ndarray:
    if hi > lo:
        return (values.astype(np.float32) - lo) / (hi - lo)
    return np.zeros_like(values, dtype=np.float32)


def predict_stage_frozen(name: str, model, vectorizer, rows: list[dict], embeddings: dict[int, np.ndarray], stats: dict) -> np.ndarray:
    texts = [text(x) for x in rows]
    X = matrix_for(rows, embeddings)
    if not is_lexical(name):
        return model.predict_proba(X)[:, 1]
    tf = vectorizer.transform(texts).toarray()
    bm = normalize_frozen(
        bm25_scores_frozen(texts, stats),
        float(stats["bm25_lo"]),
        float(stats["bm25_hi"]),
    )[:, None]
    return model.predict_proba(np.hstack([X, tf, bm]))[:, 1]


def score_rows(rows: list[dict], embeddings: dict[int, np.ndarray], bundle: dict | None = None, stats: dict | None = None) -> list[dict]:
    bundle = bundle or load_bundle()
    stats = stats or load_inference_stats()
    t1, t2 = load_thresholds(bundle)
    artifact = bundle["artifact"]
    p1 = predict_stage_frozen(artifact["stage1_model_name"], bundle["stage1_model"], bundle["stage1_vectorizer"], rows, embeddings, stats)
    p2 = predict_stage_frozen(artifact["stage2_model_name"], bundle["stage2_model"], bundle["stage2_vectorizer"], rows, embeddings, stats)
    out = []
    for row, stage1, stage2 in zip(rows, p1, p2):
        admit = bool(stage1 >= t1 and stage2 >= t2)
        out.append({
            "article_id": int(row["article_id"]),
            "admit": admit,
            "stage1": float(stage1),
            "stage2": float(stage2),
            "stage1_threshold": t1,
            "stage2_threshold": t2,
            "model_version": MODEL_VERSION,
            "composition": "AND",
        })
    return out


def score_one(row: dict, embedding: np.ndarray, bundle: dict | None = None, stats: dict | None = None) -> dict:
    aid = int(row.get("article_id") or 0)
    return score_rows([{**row, "article_id": aid}], {aid: np.asarray(embedding, dtype=np.float32)}, bundle=bundle, stats=stats)[0]


def and_metric(rows: list[dict], embeddings: dict[int, np.ndarray], bundle: dict, stats: dict) -> dict:
    scored = score_rows(rows, embeddings, bundle=bundle, stats=stats)
    y = np.asarray([int(row["relevant"]) for row in rows])
    pred = np.asarray([1.0 if item["admit"] else 0.0 for item in scored], dtype=np.float32)
    return metric(y, pred, 0.5)


def self_test() -> dict:
    from train_it_v4 import load_embeddings
    fixtures = json.loads(FIXTURES.read_text(encoding="utf-8"))
    bundle = load_bundle()
    stats = load_inference_stats()
    embeddings = load_embeddings()
    rows = [{"article_id": int(item["article_id"]), "title": item["title"], "summary": item["summary"]} for item in fixtures["items"]]
    missing = [row["article_id"] for row in rows if row["article_id"] not in embeddings]
    if missing:
        raise RuntimeError(f"missing fixture embeddings: {missing}")
    scored = score_rows(rows, embeddings, bundle=bundle, stats=stats)
    mismatches = []
    for expected, actual in zip(fixtures["items"], scored):
        if bool(expected["admit"]) != bool(actual["admit"]):
            mismatches.append({
                "article_id": expected["article_id"],
                "expected": expected["admit"],
                "actual": actual["admit"],
            })
    if mismatches:
        raise SystemExit(json.dumps({"ok": False, "mismatches": mismatches}, indent=2))
    return {"ok": True, "n": len(scored), "model_version": MODEL_VERSION}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    if args.self_test:
        print(json.dumps(self_test(), indent=2))
        return 0
    parser.error("use --self-test, or import score_rows / score_one")
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
