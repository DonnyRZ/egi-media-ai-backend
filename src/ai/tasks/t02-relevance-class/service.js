const { createHash } = require("crypto");

const { AiConfigurationError } = require("../../provider/provider.errors");
const { T02_PROMPT_ID, T02_PROMPT_VERSION } = require("./definition");
const { T02_OUTPUT_SCHEMA } = require("./schema");
const { buildT02Input } = require("./prompt");
const { validateT02Output } = require("./output-validator");
const { isContinuingRelevance } = require("./relevance-policy");

const RELEVANCE_RANK = Object.freeze({ none: 0, low: 1, medium: 2, high: 3 });

function resolveT02InputOptions(env = process.env) {
  const includeBodySnippet = String(env.T02_INCLUDE_BODY_SNIPPET || "").toLowerCase() === "true"
    || String(env.T02_INCLUDE_BODY_SNIPPET || "") === "1";
  const bodySnippetChars = Number.parseInt(env.T02_BODY_SNIPPET_CHARS || "1500", 10);
  const dualCall = String(env.T02_DUAL_CALL || "true").toLowerCase() !== "false";
  const consensusCalls = Number.parseInt(env.T02_CONSENSUS_CALLS || (dualCall ? "3" : "1"), 10);
  return {
    includeBodySnippet,
    bodySnippetChars: Number.isInteger(bodySnippetChars) && bodySnippetChars > 0 ? bodySnippetChars : 1500,
    useRubric: String(env.T02_USE_RUBRIC || "true").toLowerCase() !== "false",
    dualCall,
    consensusCalls: Number.isInteger(consensusCalls) && consensusCalls > 0 ? Math.min(consensusCalls, 3) : 1,
  };
}

/** Prefer stop on continue/stop ties; majority otherwise; conservative fallback. */
function mergeRelevanceOutputs(...outputs) {
  const votes = outputs.filter(Boolean);
  if (votes.length === 0) throw new Error("mergeRelevanceOutputs requires at least one output");
  if (votes.length === 1) return { relevance: votes[0].relevance, confidence: votes[0].confidence };

  const minConfidence = Math.min(...votes.map((v) => v.confidence));

  // All stop-class votes → collapse to none (eliminates low↔none flip without reopening issues).
  if (votes.every((v) => !isContinuingRelevance(v.relevance))) {
    return { relevance: "none", confidence: minConfidence };
  }

  const counts = {};
  for (const vote of votes) counts[vote.relevance] = (counts[vote.relevance] || 0) + 1;
  const ranked = Object.entries(counts).sort((a, b) => b[1] - a[1] || RELEVANCE_RANK[a[0]] - RELEVANCE_RANK[b[0]]);
  if (ranked[0][1] > votes.length / 2) {
    return { relevance: ranked[0][0], confidence: minConfidence };
  }

  // No majority: if any stop-class vote exists against continue, prefer stop (more conservative).
  const stopVotes = votes.filter((v) => !isContinuingRelevance(v.relevance));
  if (stopVotes.length && stopVotes.length !== votes.length) {
    return { relevance: "none", confidence: minConfidence };
  }

  // All continuing without majority: pick most conservative continuing class (medium over high).
  votes.sort((a, b) => RELEVANCE_RANK[a.relevance] - RELEVANCE_RANK[b.relevance]);
  return { relevance: votes[0].relevance, confidence: minConfidence };
}

class RelevanceClassificationService {
  constructor({ cmsSourceGate, getEffectiveContext, promptExecutionService, decisionStore, authorizeCompany = denyByDefault, inputOptions = null }) {
    if (!cmsSourceGate?.requirePublishedArticle) throw new AiConfigurationError("T02 requires CMS source gate");
    if (typeof getEffectiveContext !== "function") throw new AiConfigurationError("T02 requires effective Company Context reader");
    if (!promptExecutionService?.executeActive) throw new AiConfigurationError("T02 requires prompt execution service");
    if (!decisionStore?.get || !decisionStore?.create) throw new AiConfigurationError("T02 requires relevance decision store");
    this.cmsSourceGate = cmsSourceGate;
    this.getEffectiveContext = getEffectiveContext;
    this.promptExecutionService = promptExecutionService;
    this.decisionStore = decisionStore;
    this.authorizeCompany = authorizeCompany;
    this.inputOptions = inputOptions || resolveT02InputOptions();
  }

  async classify({ tenantId = null, companyId, articleId, locale }) {
    await this._authorizeCompany(companyId);
    const context = await this.getEffectiveContext(companyId, tenantId);
    this._validateEffectiveContext(context, companyId);
    const source = await this.cmsSourceGate.requirePublishedArticle({ articleId, locale });
    const inputFingerprint = fingerprint({ source, contextVersion: context.version, inputOptions: this.inputOptions });
    const existing = await this.decisionStore.get({ tenantId, articleId, companyId, contextVersion: context.version, inputFingerprint });
    if (existing) return { decision: existing, reused: true, shouldContinue: isContinuingRelevance(existing.relevance) };

    const input = buildT02Input({ companyId, context, source, options: this.inputOptions });
    const callCount = this.inputOptions.dualCall ? (this.inputOptions.consensusCalls || 3) : 1;
    const passes = [];
    for (let i = 0; i < callCount; i += 1) {
      passes.push(await this._executeOnce({ tenantId, companyId, input }));
    }
    const output = mergeRelevanceOutputs(...passes.map((p) => p.data));
    const provenance = {
      ...passes[0].provenance,
      consensusCalls: callCount,
      passes: passes.map((p) => p.data),
      merged: output,
    };

    const decision = await this.decisionStore.create({
      tenantId,
      articleId,
      companyId,
      contextVersion: context.version,
      inputFingerprint,
      source,
      output,
      provenance,
    });

    return { decision, reused: false, shouldContinue: isContinuingRelevance(decision.relevance) };
  }

  async _executeOnce({ tenantId, companyId, input }) {
    return this.promptExecutionService.executeActive({
      promptId: T02_PROMPT_ID,
      promptVersion: T02_PROMPT_VERSION,
      model: "mini",
      input,
      outputSchema: T02_OUTPUT_SCHEMA,
      budgetScope: { tenantId, companyId },
      validateResult: validateT02Output,
    });
  }

  _validateEffectiveContext(context, companyId) {
    if (!context || context.status !== "effective" || context.companyId !== companyId || !Number.isInteger(context.version)) {
      throw new AiConfigurationError("T02 requires an approved effective Company Context for the same company");
    }
  }

  async _authorizeCompany(companyId) {
    const granted = await this.authorizeCompany({ companyId, action: "relevance.classify" });
    if (granted !== true) throw new AiConfigurationError("T02 company authorization was not granted");
  }
}

/**
 * Stable article×context fingerprint. Body-snippet mode extends the hash so
 * title/summary-only and body-aware classifications do not collide.
 * Callers without inputOptions match the historical title+summary fingerprint.
 */
function fingerprint({ source, contextVersion, inputOptions = null }) {
  const base = {
    articleId: source.sourceArticleId,
    requestedLocale: source.requestedLocale,
    contentLocale: source.contentLocale,
    publishedAt: source.article.publishedAt,
    updatedAt: source.article.updatedAt,
    title: source.article.title,
    summary: source.article.summary,
    contextVersion,
  };
  if (inputOptions?.includeBodySnippet) {
    const raw = typeof source.article?.content === "string" ? source.article.content : "";
    const cleaned = raw.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    const chars = inputOptions.bodySnippetChars || 1500;
    base.bodySnippet = cleaned.slice(0, chars);
    base.bodySnippetChars = chars;
  }
  return createHash("sha256").update(JSON.stringify(base)).digest("hex");
}

function denyByDefault() {
  throw new AiConfigurationError("T02 requires a company authorization guard");
}

module.exports = {
  RelevanceClassificationService,
  fingerprint,
  resolveT02InputOptions,
  mergeRelevanceOutputs,
};
