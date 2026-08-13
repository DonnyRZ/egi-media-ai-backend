FROM python:3.12-slim-bookworm

ENV PYTHONUNBUFFERED=1 \
    TOKENIZERS_PARALLELISM=false \
    IT_V4_SCORER_HOST=0.0.0.0 \
    PORT=8091

WORKDIR /app

COPY requirements-scorer.txt ./
RUN pip install --no-cache-dir -r requirements-scorer.txt

COPY python ./python
COPY data ./data

RUN python -c "from huggingface_hub import snapshot_download; snapshot_download(repo_id='Qwen/Qwen3-Embedding-0.6B', revision='66e95e324bebb9453d3b5be447c898dca1ba0eb0', local_dir='data/industry-relevance-qwen-v1/model/qwen3-embedding-0.6b')"

ENV HF_HUB_OFFLINE=1 \
    TRANSFORMERS_OFFLINE=1

EXPOSE 8091

CMD ["python", "python/serve_it_v4.py"]
