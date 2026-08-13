"use strict";

function createIndustryPrefilterClient({ url, timeoutMs = 8000, fetchImpl = fetch } = {}) {
  const base = String(url || "").replace(/\/$/, "");
  if (!base) throw new TypeError("Industry prefilter client requires a scorer URL");

  async function score({ title = "", summary = "", content = "" } = {}) {
    const started = Date.now();
    try {
      const response = await fetchImpl(`${base}/score`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title, summary, content }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || typeof body.admit !== "boolean") {
        return fail(started, body.error || `scorer_http_${response.status}`);
      }
      return {
        ok: true,
        admit: body.admit,
        stage1: Number(body.stage1),
        stage2: Number(body.stage2),
        stage1Threshold: Number(body.stage1_threshold),
        stage2Threshold: Number(body.stage2_threshold),
        modelVersion: body.model_version || "it-v4",
        composition: body.composition || "AND",
        scorerMs: Date.now() - started,
        error: null,
      };
    } catch (error) {
      return fail(started, error?.message || "scorer_unreachable");
    }
  }

  function fail(started, error) {
    return {
      ok: false,
      admit: null,
      stage1: null,
      stage2: null,
      stage1Threshold: null,
      stage2Threshold: null,
      modelVersion: "it-v4",
      composition: "AND",
      scorerMs: Date.now() - started,
      error: String(error).slice(0, 300),
    };
  }

  return { score };
}

module.exports = { createIndustryPrefilterClient };
