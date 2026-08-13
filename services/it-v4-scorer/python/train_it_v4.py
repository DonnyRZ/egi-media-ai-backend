"""Train IT v4 two-stage overlap specialist.

Stage 1: DFR on all 260. Stage 2: logistic on overlap 144 only.
Composition AND is confirm-only on the temporal calibration split.
Does not overwrite it.joblib v1, it-v3, hospitality, or Qwen weights.
"""
from __future__ import annotations

import json
from pathlib import Path

import joblib
import numpy as np

from train_it_v3 import (
    CACHES,
    C_REG,
    DIM,
    GROUPS,
    IT_TERMS,
    MODEL_ID,
    REVISION,
    bm25_scores,
    candidate_rank,
    choose_threshold,
    group_metrics,
    group_weights,
    load_cache,
    make_model,
    make_vectorizer,
    metric,
    normalize,
    rhetoric_specificity,
    sha256,
    text,
)

OVERLAP = ("core_it", "digital_rhetoric", "adjacent_non_it")
ROOT = Path(__file__).resolve().parents[1]
V4 = ROOT / "data" / "industry-relevance-qwen-v1" / "it-v4"


def load_embeddings() -> dict[int, np.ndarray]:
    found: dict[int, np.ndarray] = {}
    base = ROOT / "data" / "industry-relevance-qwen-v1" / "embedding-cache"
    for name in CACHES:
        for aid, vector in load_cache(base / name).items():
            found.setdefault(aid, vector)
    return found


def load_rows() -> list[dict]:
    labels = [json.loads(line) for line in (V4 / "labels" / "development.labels.jsonl").read_text(encoding="utf-8").splitlines() if line.strip()]
    queue = {int(json.loads(line)["article_id"]): json.loads(line) for line in (V4 / "labels" / "development-queue.jsonl").read_text(encoding="utf-8").splitlines() if line.strip()}
    manifest = {int(json.loads(line)["article_id"]): json.loads(line) for line in (V4 / "labels" / "development-manifest.jsonl").read_text(encoding="utf-8").splitlines() if line.strip()}
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


def matrix_for(rows: list[dict], embeddings: dict[int, np.ndarray]) -> np.ndarray:
    return np.vstack([embeddings[int(row["article_id"])] for row in rows])


def is_lexical(name: str) -> bool:
    return name.endswith("plus_lexical")


def train_stage(fit: list[dict], calibration: list[dict], embeddings: dict[int, np.ndarray], names: tuple[str, str]):
    from sklearn.model_selection import TimeSeriesSplit

    fit_text = [text(x) for x in fit]
    cal_text = [text(x) for x in calibration]
    y_fit = np.asarray([int(x["relevant"]) for x in fit])
    y_cal = np.asarray([int(x["relevant"]) for x in calibration])
    g_fit = np.asarray([x["group"] for x in fit])
    g_cal = np.asarray([x["group"] for x in calibration])
    X_fit = matrix_for(fit, embeddings)
    X_cal = matrix_for(calibration, embeddings)
    bm_fit = normalize(bm25_scores(fit_text, IT_TERMS))[:, None]
    bm_cal = normalize(bm25_scores(cal_text, IT_TERMS))[:, None]
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
            if is_lexical(name):
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
        if is_lexical(name):
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
        pack = (name, threshold, cal_metric, model, final_vectorizer, oof_metric, cal_score)
        if selected is None or candidate_rank(oof_metric) > candidate_rank(selected[5]):
            selected = pack
    return candidate_reports, selected


def predict_stage(name: str, model, vectorizer, rows: list[dict], embeddings: dict[int, np.ndarray]) -> np.ndarray:
    texts = [text(x) for x in rows]
    X = matrix_for(rows, embeddings)
    if is_lexical(name):
        tf = vectorizer.transform(texts).toarray()
        bm = normalize(bm25_scores(texts, IT_TERMS))[:, None]
        return model.predict_proba(np.hstack([X, tf, bm]))[:, 1]
    return model.predict_proba(X)[:, 1]


def overlap_only(rows: list[dict]) -> list[dict]:
    return [row for row in rows if row["group"] in OVERLAP]


def write_decision(status: str, report: dict, passed: bool) -> None:
    decision = {
        "schema_version": "industry-relevance-it-v4-training-decision.v1",
        "status": status,
        "industry_id": "it",
        "frozen": passed,
        "shadow_opened": False,
        "validation_opened": False,
        "old_validation_scored": False,
        "v1_it_joblib_overwritten": False,
        "pipeline_validation_status": "LOCKED",
        "pipeline_test_status": "LOCKED",
        "hospitality": "UNTOUCHED",
        "evaluation": "data/industry-relevance-qwen-v1/it-v4/audits/training-report.json",
        "composed_calibration": report.get("composed_calibration"),
        "stage1": report.get("stage1", {}).get("selected"),
        "stage2": report.get("stage2", {}).get("selected"),
        "reason": (
            "Composed AND passed the calibration gate."
            if passed
            else "Composed AND missed P>=0.80 and R>=0.90 on calibration. Protocol stops: no extra supplement, no NLI, no LoRA, no threshold retune, no shadow."
        ),
        "test": "LOCKED",
    }
    (V4 / "audits" / "training-decision.json").write_text(json.dumps(decision, indent=2) + "\n", encoding="utf-8")


def main() -> int:
    rows = load_rows()
    embeddings = load_embeddings()
    missing = sorted({int(row["article_id"]) for row in rows} - set(embeddings))
    if missing:
        raise RuntimeError(f"missing embeddings for {len(missing)} development articles: {missing[:10]}")
    items = sorted(rows, key=lambda row: (row.get("published_at") or "", int(row["article_id"])))
    n = len(items)
    cut = max(2, int(n * 0.70))
    fit, calibration = items[:cut], items[cut:]
    s1_reports, s1 = train_stage(fit, calibration, embeddings, ("qwen_embedding", "qwen_plus_lexical"))
    if s1 is None:
        raise RuntimeError("cannot train it-v4 stage 1")
    s1_name, s1_threshold, s1_cal, s1_model, s1_vectorizer, s1_oof, _ = s1
    fit_overlap, cal_overlap = overlap_only(fit), overlap_only(calibration)
    if len(fit_overlap) < 8 or len(cal_overlap) < 4:
        raise RuntimeError(f"overlap split too small: fit={len(fit_overlap)} cal={len(cal_overlap)}")
    s2_reports, s2 = train_stage(fit_overlap, cal_overlap, embeddings, ("qwen_embedding", "qwen_plus_lexical"))
    if s2 is None:
        raise RuntimeError("cannot train it-v4 stage 2")
    s2_name, s2_threshold, s2_cal, s2_model, s2_vectorizer, s2_oof, _ = s2
    y_cal = np.asarray([int(x["relevant"]) for x in calibration])
    g_cal = np.asarray([x["group"] for x in calibration])
    p1 = predict_stage(s1_name, s1_model, s1_vectorizer, calibration, embeddings)
    p2 = predict_stage(s2_name, s2_model, s2_vectorizer, calibration, embeddings)
    composed_score = np.minimum(p1, p2)
    composed_pred = (p1 >= s1_threshold) & (p2 >= s2_threshold)
    # metric() thresholds a score; feed 1/0 as scores with threshold 0.5
    composed = metric(y_cal, composed_pred.astype(np.float32), 0.5)
    composed["rhetoric_specificity"] = float((~composed_pred[g_cal == "digital_rhetoric"]).mean()) if (g_cal == "digital_rhetoric").any() else 0.0
    composed["group_metrics"] = group_metrics(y_cal, composed_pred.astype(np.float32), 0.5, g_cal)
    composed["average_precision"] = metric(y_cal, composed_score, 0.5)["average_precision"]
    passed = composed["precision"] >= 0.80 and composed["recall"] >= 0.90 and composed["candidate_reduction"] > 0
    status = "TRAINING_PASSED" if passed else "IT_V4_TRAINING_FAILED"
    artifact = {
        "industry_id": "it",
        "version": "it-v4",
        "stage1_model_name": s1_name,
        "stage1_threshold": float(s1_threshold),
        "stage2_model_name": s2_name,
        "stage2_threshold": float(s2_threshold),
        "model_id": MODEL_ID,
        "revision": REVISION,
        "embedding_dim": DIM,
        "feature_version": "qwen-l512-two-stage-overlap-v4",
        "C": C_REG,
        "training_status": "CANDIDATE_FROZEN" if passed else "IT_V4_TRAINING_FAILED",
        "validation": "LOCKED",
        "test": "LOCKED",
    }
    report = {
        "schema_version": "industry-relevance-it-v4-training-report.v1",
        "status": status,
        "model_id": MODEL_ID,
        "revision": REVISION,
        "C": C_REG,
        "n": n,
        "fit": len(fit),
        "calibration": len(calibration),
        "overlap_fit": len(fit_overlap),
        "overlap_calibration": len(cal_overlap),
        "group_counts": {group: sum(row["group"] == group for row in items) for group in GROUPS},
        "stage1": {
            "selected": s1_name,
            "threshold": float(s1_threshold),
            "oof": s1_oof,
            "calibration": s1_cal,
            "candidates": s1_reports,
        },
        "stage2": {
            "selected": s2_name,
            "threshold": float(s2_threshold),
            "oof": s2_oof,
            "calibration": s2_cal,
            "candidates": s2_reports,
            "train_groups": list(OVERLAP),
        },
        "composed_calibration": composed,
        "development_label_sha256": sha256(V4 / "labels" / "development.labels.jsonl"),
        "validation": "LOCKED",
        "test": "LOCKED",
    }
    out = V4 / "model"
    out.mkdir(parents=True, exist_ok=True)
    (V4 / "audits").mkdir(parents=True, exist_ok=True)
    joblib.dump(
        {
            "stage1_model": s1_model,
            "stage1_vectorizer": s1_vectorizer,
            "stage2_model": s2_model,
            "stage2_vectorizer": s2_vectorizer,
            "artifact": artifact,
        },
        out / "it-v4.joblib",
    )
    (out / "it-v4.manifest.json").write_text(json.dumps(artifact, indent=2) + "\n", encoding="utf-8")
    (V4 / "audits" / "training-report.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    if passed:
        frozen = {
            "schema_version": "industry-relevance-it-v4-candidate.v1",
            "status": "CANDIDATE_FROZEN",
            "industry_id": "it",
            "joblib": "data/industry-relevance-qwen-v1/it-v4/model/it-v4.joblib",
            "joblib_sha256": sha256(out / "it-v4.joblib"),
            "manifest": "data/industry-relevance-qwen-v1/it-v4/model/it-v4.manifest.json",
            "stage1_threshold": float(s1_threshold),
            "stage2_threshold": float(s2_threshold),
            "stage1_model_name": s1_name,
            "stage2_model_name": s2_name,
            "development_metrics": composed,
            "test": "LOCKED",
        }
        (out / "it-v4.frozen.json").write_text(json.dumps(frozen, indent=2) + "\n", encoding="utf-8")
    write_decision(status, report, passed)
    print(json.dumps({
        "status": status,
        "stage1": {"selected": s1_name, "threshold": float(s1_threshold), "precision": s1_cal["precision"], "recall": s1_cal["recall"]},
        "stage2": {"selected": s2_name, "threshold": float(s2_threshold), "precision": s2_cal["precision"], "recall": s2_cal["recall"]},
        "composed": {
            "precision": composed["precision"],
            "recall": composed["recall"],
            "rhetoric_specificity": composed["rhetoric_specificity"],
            "candidate_reduction": composed["candidate_reduction"],
            "fp": composed["fp"],
            "fn": composed["fn"],
        },
    }, indent=2))
    return 0 if passed else 2


if __name__ == "__main__":
    raise SystemExit(main())
