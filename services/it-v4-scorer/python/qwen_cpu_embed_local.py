"""Resumable local CPU embedding writer with fixed-size article shards."""
import argparse
import hashlib
import json
import os
import struct
import time
from pathlib import Path


MODEL_ID = "Qwen/Qwen3-Embedding-0.6B"
REVISION = "66e95e324bebb9453d3b5be447c898dca1ba0eb0"


def text_for(row: dict, instruction: str = "") -> str:
    body = "Title: {}\nSummary: {}\nContent: {}".format(row.get("title") or "", row.get("summary") or "", row.get("content") or row.get("body") or "")
    return ("Instruct: {}\nQuery: {}".format(instruction, body)) if instruction else body


def iter_shards(path: Path, shard_size: int):
    batch = []
    with path.open("r", encoding="utf-8") as stream:
        for line in stream:
            if not line.strip():
                continue
            batch.append(json.loads(line))
            if len(batch) == shard_size:
                yield batch
                batch = []
    if batch:
        yield batch


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", required=True)
    parser.add_argument("--runtime", choices=["pytorch"], default="pytorch")
    parser.add_argument("--max-length", type=int, choices=[512, 1024], default=512)
    parser.add_argument("--batch-size", type=int, default=8)
    parser.add_argument("--shard-size", type=int, default=500)
    parser.add_argument("--sample-manifest", default=None)
    parser.add_argument("--cache-name", default=None, help="Explicit cache directory name under embedding-cache")
    parser.add_argument("--instruction", default="", help="Optional retrieval instruction included in the input hash")
    args = parser.parse_args()
    root = Path(args.root).resolve()
    os.environ["HF_HUB_OFFLINE"] = "1"
    os.environ["TRANSFORMERS_OFFLINE"] = "1"
    os.environ["TOKENIZERS_PARALLELISM"] = "false"
    import numpy as np
    from sentence_transformers import SentenceTransformer

    sample_ids = None
    if args.sample_manifest:
        sample_ids = {
            int(json.loads(line)["article_id"])
            for line in (root / args.sample_manifest).open("r", encoding="utf-8")
            if line.strip()
        }
    base_name = args.cache_name or (f"sample-v2-pytorch-fp32-l{args.max_length}" if sample_ids is not None else f"pytorch-fp32-l{args.max_length}")
    base = root / "data" / "industry-relevance-qwen-v1" / "embedding-cache" / base_name
    base.mkdir(parents=True, exist_ok=True)
    model_path = root / "data" / "industry-relevance-qwen-v1" / "model" / "qwen3-embedding-0.6b"
    model = SentenceTransformer(str(model_path), device="cpu", trust_remote_code=True, local_files_only=True)
    model.max_seq_length = args.max_length
    shards = []
    total_articles = 0
    raw_source_shards = iter_shards(root / "data" / "raw" / "egi-crawl" / "articles.jsonl", args.shard_size)
    source_shards = raw_source_shards
    if sample_ids is not None:
        def selected_shards():
            buffer = []
            for raw_shard in raw_source_shards:
                for row in raw_shard:
                    if int(row["article_id"]) in sample_ids:
                        buffer.append(row)
                        if len(buffer) == args.shard_size:
                            yield buffer
                            buffer = []
            if buffer:
                yield buffer
        source_shards = selected_shards()
    for shard_id, shard_rows in enumerate(source_shards):
        if not shard_rows:
            continue
        total_articles += len(shard_rows)
        vector_file = base / f"shard-{shard_id:04d}.f32"
        index_file = base / f"shard-{shard_id:04d}.index.jsonl"
        status_file = base / f"shard-{shard_id:04d}.status.json"
        if status_file.exists() and json.loads(status_file.read_text(encoding="utf-8")).get("status") == "complete":
            shards.append(json.loads(status_file.read_text(encoding="utf-8")))
            continue
        started = time.perf_counter()
        temp_vector = vector_file.with_suffix(".f32.tmp")
        temp_index = index_file.with_suffix(".jsonl.tmp")
        texts = [text_for(row, args.instruction) for row in shard_rows]
        vectors = model.encode(texts, batch_size=args.batch_size, normalize_embeddings=True, convert_to_numpy=True, show_progress_bar=False)
        if vectors.shape[1] != 1024 or not np.isfinite(vectors).all():
            raise RuntimeError(f"invalid vector output for shard {shard_id}")
        with temp_vector.open("wb") as binary, temp_index.open("w", encoding="utf-8", newline="\n") as index:
            for offset, (row, text, vector) in enumerate(zip(shard_rows, texts, vectors, strict=True)):
                binary.write(struct.pack("<1024f", *vector.tolist()))
                index.write(json.dumps({"article_id": int(row["article_id"]), "offset": offset, "input_sha256": hashlib.sha256(text.encode("utf-8")).hexdigest(), "content_hash": row.get("content_hash"), "model_id": MODEL_ID, "revision": REVISION, "instruction": args.instruction, "normalized": True}) + "\n")
        temp_vector.replace(vector_file)
        temp_index.replace(index_file)
        status = {"shard_id": shard_id, "status": "complete", "article_count": len(shard_rows), "elapsed_seconds": round(time.perf_counter() - started, 3), "vector_file": vector_file.name, "index_file": index_file.name}
        status_file.write_text(json.dumps(status, indent=2) + "\n", encoding="utf-8")
        shards.append(status)
        print(json.dumps(status))
    manifest = {"schema_version": "industry-relevance-qwen-shard-manifest.v1", "model_id": MODEL_ID, "revision": REVISION, "runtime": args.runtime, "precision": "fp32", "max_length": args.max_length, "shard_size": args.shard_size, "article_count": total_articles, "completed_shards": len(shards), "completed_articles": sum(item["article_count"] for item in shards), "shards": shards}
    (base / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(manifest, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
