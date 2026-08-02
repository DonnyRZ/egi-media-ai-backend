/**
 * Attach the pipeline state identifier to persisted AI provenance.
 *
 * Pipeline workers already pass this identifier to every task handler. Keeping
 * it optional preserves direct/manual task callers while making worker output
 * joinable to ai.pipeline_states and ai.queue_jobs for new runs.
 */
function withPipelineTrace(provenance, pipelineId, context = null) {
  const trace = { ...(provenance || {}) };
  if (typeof pipelineId === "string" && pipelineId.trim()) trace.pipelineId = pipelineId;

  const contextVersion = Number.isInteger(context?.contextVersion)
    ? context.contextVersion
    : (Number.isInteger(context?.version) ? context.version : null);
  if (contextVersion !== null) trace.contextVersion = contextVersion;

  const identityFingerprint = context?.identityFingerprint
    || context?.managementIdentity?.fingerprint
    || context?.management_identity?.fingerprint
    || null;
  if (typeof identityFingerprint === "string" && identityFingerprint.trim()) {
    trace.identityFingerprint = identityFingerprint;
  }
  return trace;
}

function resolvePipelineId(value = {}) {
  return value.pipelineId
    || value.pipelineRunId
    || value.provenance?.pipelineId
    || value.provenance?.pipelineRunId
    || null;
}

module.exports = { withPipelineTrace, resolvePipelineId };
