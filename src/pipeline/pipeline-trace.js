/**
 * Attach the pipeline state identifier to persisted AI provenance.
 *
 * Pipeline workers already pass this identifier to every task handler. Keeping
 * it optional preserves direct/manual task callers while making worker output
 * joinable to ai.pipeline_states and ai.queue_jobs for new runs.
 */
function withPipelineTrace(provenance, pipelineId) {
  if (typeof pipelineId !== "string" || !pipelineId.trim()) return provenance;
  return { ...(provenance || {}), pipelineId };
}

function resolvePipelineId(value = {}) {
  return value.pipelineId
    || value.pipelineRunId
    || value.provenance?.pipelineId
    || value.provenance?.pipelineRunId
    || null;
}

module.exports = { withPipelineTrace, resolvePipelineId };
