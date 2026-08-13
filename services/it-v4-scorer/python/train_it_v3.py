"""Train IT v3 with DFR group-balance on frozen Qwen embeddings.

OOF threshold and candidate selection. Calibration is confirm-only.
Does not read shadow, validation, or test. Does not overwrite it.joblib v1.
"""
from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path

import joblib
import numpy as np
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import average_precision_score, confusion_matrix, precision_score, recall_score
from sklearn.model_selection import TimeSeriesSplit
from sklearn.pipeline import FeatureUnion

DIM = 1024
PROJ_DIM = 256
C_REG = 0.1
MODEL_ID = "Qwen/Qwen3-Embedding-0.6B"
REVISION = "66e95e324bebb9453d3b5be447c898dca1ba0eb0"
TOKEN_RE = re.compile(r"[\w]+", re.UNICODE)
IT_TERMS = "software cloud cybersecurity data center platform SaaS infrastructure saas siber keamanan pusat infrastruktur server chip semiconductor".split()
CACHES = (
    "sample-v2-pytorch-fp32-l512",
    "it-v2-supplement-pytorch-fp32-l512",
    "it-v2-extra-supplement-pytorch-fp32-l512",
    "it-v3-boundary-pytorch-fp32-l512",
)
GROUPS = ("core_it", "digital_rhetoric", "adjacent_non_it", "unrelated")


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()


def text(row: dict) -> str:
    return f"{row.get('title') or ''} {row.get('summary') or ''}".lower()


def tokens(value: str) -> list[str]:
    return TOKEN_RE.findall(value.lower())


def metric(y: np.ndarray, score: np.ndarray, threshold: float) -> dict:
    pred = score >= threshold
    tn, fp, fn, tp = confusion_matrix(y, pred, labels=[0, 1]).ravel()
    return {
        "n": int(len(y)),
        "positive": int(y.sum()),
        "predicted_positive": int(pred.sum()),
        "precision": float(precision_score(y, pred, zero_division=0)),
        "recall": float(recall_score(y, pred, zero_division=0)),
        "fpr": float(fp / (fp + tn)) if fp + tn else 0.0,
        "fnr": float(fn / (fn + tp)) if fn + tp else 0.0,
        "candidate_reduction": float(1.0 - pred.mean()) if len(pred) else 0.0,
        "average_precision": float(average_precision_score(y, score)) if len(np.unique(y)) > 1 else None,
        "tp": int(tp), "fp": int(fp), "tn": int(tn), "fn": int(fn),
    }


def rhetoric_specificity(score: np.ndarray, threshold: float, groups: np.ndarray) -> float:
    mask = groups == "digital_rhetoric"
    if not mask.any():
        return 0.0
    pred = score[mask] >= threshold
    return float((~pred).mean())


def group_metrics(y: np.ndarray, score: np.ndarray, threshold: float, groups: np.ndarray) -> dict:
    out = {}
    pred = score >= threshold
    for group in GROUPS:
        mask = groups == group
        if not mask.any():
            out[group] = None
            continue
        yg, pg = y[mask], pred[mask]
        out[group] = {
            "n": int(mask.sum()),
            "positive": int(yg.sum()),
            "predicted_positive": int(pg.sum()),
            "accuracy": float((pg == yg).mean()),
        }
    return out


def choose_threshold(y: np.ndarray, score: np.ndarray, groups: np.ndarray) -> tuple[float, dict]:
    candidates = np.unique(np.r_[0.0, score, 1.0])
    reports = []
    for t in candidates:
        m = metric(y, score, float(t))
        m["rhetoric_specificity"] = rhetoric_specificity(score, float(t), groups)
        reports.append((float(t), m))
    eligible = [(t, m) for t, m in reports if m["recall"] >= 0.90 and m["precision"] >= 0.80]
    if eligible:
        return max(eligible, key=lambda x: (x[1]["rhetoric_specificity"], x[1]["precision"], x[1]["candidate_reduction"]))
    high_r = [(t, m) for t, m in reports if m["recall"] >= 0.90]
    if high_r:
        return max(high_r, key=lambda x: (x[1]["precision"], x[1]["rhetoric_specificity"], x[1]["candidate_reduction"]))
    return max(reports, key=lambda x: (x[1]["recall"], x[1]["precision"]))


def group_weights(groups: np.ndarray) -> np.ndarray:
    n = len(groups)
    uniq, counts = np.unique(groups, return_counts=True)
    freq = {str(g): int(c) for g, c in zip(uniq, counts)}
    k = max(len(freq), 1)
    return np.asarray([n / (k * freq[str(g)]) for g in groups], dtype=np.float64)


def bm25_scores(documents: list[str], query_terms: list[str]) -> np.ndarray:
    docs = [tokens(d) for d in documents]
    n = len(docs)
    avgdl = sum(map(len, docs)) / max(n, 1)
    df: dict[str, int] = {}
    for doc in docs:
        for term in set(doc):
            df[term] = df.get(term, 0) + 1
    scores = np.zeros(n, dtype=np.float32)
    for i, doc in enumerate(docs):
        counts = {term: doc.count(term) for term in set(doc)}
        for term in set(query_terms):
            if term not in counts:
                continue
            idf = np.log(1 + (n - df.get(term, 0) + 0.5) / (df.get(term, 0) + 0.5))
            tf = counts[term]
            scores[i] += idf * (tf * 2.0) / (tf + 1.2 * (0.25 + 0.75 * len(doc) / max(avgdl, 1)))
    return scores


def normalize(values: np.ndarray) -> np.ndarray:
    lo, hi = float(values.min()), float(values.max())
    return (values - lo) / (hi - lo) if hi > lo else np.zeros_like(values)


def l2_normalize(matrix: np.ndarray) -> np.ndarray:
    norms = np.linalg.norm(matrix, axis=1, keepdims=True)
    norms = np.maximum(norms, 1e-12)
    return matrix / norms


def apply_projection(matrix: np.ndarray, projection: dict | None) -> np.ndarray:
    if projection is None:
        return matrix
    projected = matrix @ np.asarray(projection["W"], dtype=np.float32)
    return l2_normalize(projected) if projection.get("normalize", True) else projected


def make_vectorizer() -> FeatureUnion:
    return FeatureUnion([
        ("word", TfidfVectorizer(ngram_range=(1, 2), min_df=1, max_features=2500)),
        ("char", TfidfVectorizer(analyzer="char", ngram_range=(3, 5), min_df=1, max_features=2500)),
    ])


def load_cache(path: Path) -> dict[int, np.ndarray]:
    found: dict[int, np.ndarray] = {}
    if not path.exists():
        return found
    for index_path in sorted(path.glob("*.index.jsonl")):
        f32_path = index_path.parent / index_path.name.replace(".index.jsonl", ".f32")
        raw = np.fromfile(f32_path, dtype=np.float32)
        if raw.size % DIM:
            raise RuntimeError(f"invalid vector shard dimension: {f32_path}")
        matrix = raw.reshape((-1, DIM))
        for line in index_path.read_text(encoding="utf-8").splitlines():
            if not line.strip():
                continue
            item = json.loads(line)
            found[int(item["article_id"])] = matrix[int(item["offset"])]
    return found


def load_embeddings(root: Path) -> dict[int, np.ndarray]:
    found: dict[int, np.ndarray] = {}
    base = root / "data" / "industry-relevance-qwen-v1" / "embedding-cache"
    for name in CACHES:
        for aid, vector in load_cache(base / name).items():
            found.setdefault(aid, vector)
    return found


def load_rows(root: Path) -> list[dict]:
    v3 = root / "data" / "industry-relevance-qwen-v1" / "it-v3"
    labels = [json.loads(line) for line in (v3 / "labels" / "development.labels.jsonl").read_text(encoding="utf-8").splitlines() if line.strip()]
    queue = {int(json.loads(line)["article_id"]): json.loads(line) for line in (v3 / "labels" / "development-queue.jsonl").read_text(encoding="utf-8").splitlines() if line.strip()}
    manifest = {int(json.loads(line)["article_id"]): json.loads(line) for line in (v3 / "labels" / "development-manifest.jsonl").read_text(encoding="utf-8").splitlines() if line.strip()}
    rows = []
    for row in labels:
        if row.get("model_output_seen") is not False:
            raise RuntimeError("prediction leakage in development labels")
        if row.get("group") not in GROUPS:
            raise RuntimeError(f"missing group for article {row.get('article_id')}")
        aid = int(row["article_id"])
        item = queue[aid]
        meta = manifest[aid]
        row = dict(row)
        row["title"] = item.get("title") or ""
        row["summary"] = item.get("summary") or ""
        row["published_at"] = meta.get("published_at") or ""
        rows.append(row)
    return rows


def make_model() -> LogisticRegression:
    return LogisticRegression(C=C_REG, class_weight=None, max_iter=2000, solver="liblinear", random_state=7)


def candidate_rank(metric_row: dict) -> tuple:
    feasible = int(metric_row["precision"] >= 0.80 and metric_row["recall"] >= 0.90)
    return (feasible, metric_row.get("rhetoric_specificity", 0.0), metric_row["precision"], metric_row["recall"])


def train_candidates(fit, calibration, X_fit, X_cal, names: tuple[str, str]):
    fit_text, cal_text = [text(x) for x in fit], [text(x) for x in calibration]
    y_fit = np.asarray([int(x["relevant"]) for x in fit])
    y_cal = np.asarray([int(x["relevant"]) for x in calibration])
    g_fit = np.asarray([x["group"] for x in fit])
    g_cal = np.asarray([x["group"] for x in calibration])
    bm_fit = normalize(bm25_scores(fit_text, IT_TERMS))[:, None]
    bm_cal = normalize(bm25_scores(cal_text, IT_TERMS))[:, None]
    keyword_cal = np.asarray([1.0 if any(term in doc for term in IT_TERMS) else 0.0 for doc in cal_text], dtype=np.float32)
    candidate_reports = {}
    selected = None
    for name in names:
        if y_fit.min() == y_fit.max():
            continue
        tscv = TimeSeriesSplit(n_splits=3)
        oof = np.full(len(y_fit), np.nan)
        for train_idx, val_idx in tscv.split(X_fit):
            if len(np.unique(y_fit[train_idx])) < 2:
                continue
            weights = group_weights(g_fit[train_idx])
            fold = make_model()
            if name.endswith("plus_lexical") or name == "qwen_plus_lexical":
                fold_vectorizer = make_vectorizer()
                fold_train_tf = fold_vectorizer.fit_transform([fit_text[i] for i in train_idx]).toarray()
                fold_val_tf = fold_vectorizer.transform([fit_text[i] for i in val_idx]).toarray()
                fold.fit(np.hstack([X_fit[train_idx], fold_train_tf, bm_fit[train_idx]]), y_fit[train_idx], sample_weight=weights)
                oof[val_idx] = fold.predict_proba(np.hstack([X_fit[val_idx], fold_val_tf, bm_fit[val_idx]]))[:, 1]
            else:
                fold.fit(X_fit[train_idx], y_fit[train_idx], sample_weight=weights)
                oof[val_idx] = fold.predict_proba(X_fit[val_idx])[:, 1]
        valid = np.isfinite(oof)
        if valid.sum() < 4 or len(np.unique(y_fit[valid])) < 2:
            continue
        threshold, oof_metric = choose_threshold(y_fit[valid], oof[valid], g_fit[valid])
        model = make_model()
        weights = group_weights(g_fit)
        if name.endswith("plus_lexical") or name == "qwen_plus_lexical":
            final_vectorizer = make_vectorizer()
            tf_fit = final_vectorizer.fit_transform(fit_text).toarray()
            tf_cal = final_vectorizer.transform(cal_text).toarray()
            model.fit(np.hstack([X_fit, tf_fit, bm_fit]), y_fit, sample_weight=weights)
            cal_score = model.predict_proba(np.hstack([X_cal, tf_cal, bm_cal]))[:, 1]
        else:
            final_vectorizer = None
            model.fit(X_fit, y_fit, sample_weight=weights)
            cal_score = model.predict_proba(X_cal)[:, 1]
        cal_metric = metric(y_cal, cal_score, threshold)
        cal_metric["rhetoric_specificity"] = rhetoric_specificity(cal_score, threshold, g_cal)
        cal_metric["group_metrics"] = group_metrics(y_cal, cal_score, threshold, g_cal)
        oof_metric["group_metrics"] = group_metrics(y_fit[valid], oof[valid], threshold, g_fit[valid])
        candidate_reports[name] = {"oof": oof_metric, "calibration": cal_metric, "threshold": threshold}
        pack = (name, threshold, cal_metric, model, final_vectorizer, oof_metric)
        if selected is None or candidate_rank(oof_metric) > candidate_rank(selected[5]):
            selected = pack
    return candidate_reports, selected, y_fit, y_cal, keyword_cal, bm_cal, g_cal


def write_outputs(v3: Path, report: dict, artifact: dict, model, vectorizer, projection, passed: bool) -> None:
    out = v3 / "model"
    out.mkdir(parents=True, exist_ok=True)
    (v3 / "audits").mkdir(parents=True, exist_ok=True)
    joblib.dump(
        {"model": model, "vectorizer": vectorizer, "projection": projection, "artifact": artifact},
        out / "it-v3.joblib",
    )
    (out / "it-v3.manifest.json").write_text(json.dumps(artifact, indent=2) + "\n", encoding="utf-8")
    (v3 / "audits" / "training-report.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    if passed:
        frozen = {
            "schema_version": "industry-relevance-it-v3-candidate.v1",
            "status": "CANDIDATE_FROZEN",
            "industry_id": "it",
            "joblib": "data/industry-relevance-qwen-v1/it-v3/model/it-v3.joblib",
            "joblib_sha256": sha256(out / "it-v3.joblib"),
            "manifest": "data/industry-relevance-qwen-v1/it-v3/model/it-v3.manifest.json",
            "threshold": artifact["threshold"],
            "model_name": artifact["model_name"],
            "has_projection": projection is not None,
            "development_metrics": report["selected_calibration"],
            "test": "LOCKED",
        }
        (out / "it-v3.frozen.json").write_text(json.dumps(frozen, indent=2) + "\n", encoding="utf-8")


def main(projection: dict | None = None, stage: str = "v3a") -> int:
    root = Path(__file__).resolve().parents[1]
    v3 = root / "data" / "industry-relevance-qwen-v1" / "it-v3"
    rows = load_rows(root)
    embeddings = load_embeddings(root)
    missing = sorted({int(row["article_id"]) for row in rows} - set(embeddings))
    if missing:
        raise RuntimeError(f"missing embeddings for {len(missing)} development articles: {missing[:10]}")
    items = sorted(rows, key=lambda row: (row.get("published_at") or "", int(row["article_id"])))
    n = len(items)
    cut = max(2, int(n * 0.70))
    fit, calibration = items[:cut], items[cut:]
    X_fit = apply_projection(np.vstack([embeddings[int(x["article_id"])] for x in fit]), projection)
    X_cal = apply_projection(np.vstack([embeddings[int(x["article_id"])] for x in calibration]), projection)
    names = ("qwen_proj", "qwen_proj_plus_lexical") if projection is not None else ("qwen_embedding", "qwen_plus_lexical")
    candidate_reports, selected, y_fit, y_cal, keyword_cal, bm_cal, g_cal = train_candidates(fit, calibration, X_fit, X_cal, names)
    if selected is None:
        raise RuntimeError("cannot train it-v3: insufficient class variation")
    selected_name, selected_threshold, selected_cal_metric, selected_model, selected_vectorizer, selected_oof = selected
    passed = (
        selected_cal_metric["precision"] >= 0.80
        and selected_cal_metric["recall"] >= 0.90
        and selected_cal_metric["candidate_reduction"] > 0
    )
    status = "TRAINING_PASSED" if passed else "IT_V3_TRAINING_FAILED"
    artifact = {
        "industry_id": "it",
        "version": "it-v3",
        "stage": stage,
        "model_name": selected_name,
        "threshold": float(selected_threshold),
        "model_id": MODEL_ID,
        "revision": REVISION,
        "embedding_dim": DIM if projection is None else PROJ_DIM,
        "feature_version": "qwen-l512-dfr-group-balance-v3",
        "C": C_REG,
        "has_projection": projection is not None,
        "training_status": "CANDIDATE_FROZEN" if passed else "IT_V3_TRAINING_FAILED",
        "validation": "LOCKED",
        "test": "LOCKED",
    }
    report = {
        "schema_version": "industry-relevance-it-v3-training-report.v1",
        "status": status,
        "stage": stage,
        "model_id": MODEL_ID,
        "revision": REVISION,
        "embedding_dim": artifact["embedding_dim"],
        "C": C_REG,
        "n": n,
        "fit": len(fit),
        "calibration": len(calibration),
        "positive_fit": int(y_fit.sum()),
        "positive_calibration": int(y_cal.sum()),
        "group_counts": {group: sum(row["group"] == group for row in items) for group in GROUPS},
        "baselines": {
            "pass_all": metric(y_cal, np.ones(len(y_cal), dtype=np.float32), 0.5),
            "keyword": metric(y_cal, keyword_cal, 0.5),
            "bm25": metric(y_cal, bm_cal[:, 0], 0.0),
        },
        "candidates": candidate_reports,
        "selected": selected_name,
        "selected_oof": selected_oof,
        "selected_threshold": float(selected_threshold),
        "selected_calibration": selected_cal_metric,
        "development_label_sha256": sha256(v3 / "labels" / "development.labels.jsonl"),
        "validation": "LOCKED",
        "test": "LOCKED",
    }
    write_outputs(v3, report, artifact, selected_model, selected_vectorizer, projection, passed)
    print(json.dumps({
        "status": status,
        "stage": stage,
        "selected": selected_name,
        "threshold": float(selected_threshold),
        "calibration": {
            "precision": selected_cal_metric["precision"],
            "recall": selected_cal_metric["recall"],
            "rhetoric_specificity": selected_cal_metric.get("rhetoric_specificity"),
            "candidate_reduction": selected_cal_metric["candidate_reduction"],
            "fp": selected_cal_metric["fp"],
            "fn": selected_cal_metric["fn"],
        },
    }, indent=2))
    return 0 if passed else 2


if __name__ == "__main__":
    raise SystemExit(main())
