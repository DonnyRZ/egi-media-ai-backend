const { createHash } = require("crypto");

const { AiConfigurationError } = require("../../provider/provider.errors");
const { T02_PROMPT_ID, T02_PROMPT_VERSION } = require("./definition");
const { T02_OUTPUT_SCHEMA } = require("./schema");
const { buildT02Input } = require("./prompt");
const { validateT02Output } = require("./output-validator");
const { isContinuingRelevance, shouldFormIssue } = require("./relevance-policy");
const { applySubjectIdentityGate } = require("./subject-identity-gate");
const { applyMarketMaterialityGate } = require("./market-materiality-gate");
const { evaluateContextCompleteness, incompleteContextError } = require("../../../company-context/completeness");

const RELEVANCE_RANK = Object.freeze({ none: 0, low: 1, medium: 2, high: 3 });
const RELATION_RANK = Object.freeze({ unrelated: 0, market: 1, competitor: 2, self: 3 });

function resolveT02InputOptions(env = process.env) {
  // Body is always available to the deterministic relation gate. Sending it to
  // the model remains explicit to preserve fingerprint/backward compatibility
  // and avoid unnecessary tokens.
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

/** Prefer stop on continue/stop ties; majority otherwise; conservative fallback. Merges subject_relation. */
function mergeRelevanceOutputs(...outputs) {
  const votes = outputs.filter(Boolean);
  if (votes.length === 0) throw new Error("mergeRelevanceOutputs requires at least one output");
  if (votes.length === 1) {
    return {
      relevance: votes[0].relevance,
      confidence: votes[0].confidence,
      subject_relation: votes[0].subject_relation || "unrelated",
    };
  }

  const minConfidence = Math.min(...votes.map((v) => v.confidence));

  // All stop-class votes → collapse to none (eliminates low↔none flip without reopening issues).
  if (votes.every((v) => !isContinuingRelevance(v.relevance))) {
    return {
      relevance: "none",
      confidence: minConfidence,
      subject_relation: mergeSubjectRelation(votes.map((v) => v.subject_relation)),
    };
  }

  const counts = {};
  for (const vote of votes) counts[vote.relevance] = (counts[vote.relevance] || 0) + 1;
  const ranked = Object.entries(counts).sort((a, b) => b[1] - a[1] || RELEVANCE_RANK[a[0]] - RELEVANCE_RANK[b[0]]);
  let relevance;
  if (ranked[0][1] > votes.length / 2) {
    relevance = ranked[0][0];
  } else {
    // No majority: if any stop-class vote exists against continue, prefer stop (more conservative).
    const stopVotes = votes.filter((v) => !isContinuingRelevance(v.relevance));
    if (stopVotes.length && stopVotes.length !== votes.length) {
      relevance = "none";
    } else {
      // All continuing without majority: pick most conservative continuing class (medium over high).
      const continuing = [...votes].sort((a, b) => RELEVANCE_RANK[a.relevance] - RELEVANCE_RANK[b.relevance]);
      relevance = continuing[0].relevance;
    }
  }

  return {
    relevance,
    confidence: minConfidence,
    subject_relation: mergeSubjectRelation(votes.map((v) => v.subject_relation)),
  };
}

function mergeSubjectRelation(relations) {
  const votes = relations.filter((r) => r && RELATION_RANK[r] != null);
  if (votes.length === 0) return "unrelated";
  // Prefer market over self on disagreement (conservative against false self).
  const counts = {};
  for (const r of votes) counts[r] = (counts[r] || 0) + 1;
  const ranked = Object.entries(counts).sort((a, b) => b[1] - a[1] || RELATION_RANK[a[0]] - RELATION_RANK[b[0]]);
  if (ranked[0][1] > votes.length / 2) return ranked[0][0];
  if (votes.includes("market") || votes.includes("unrelated")) {
    return votes.includes("market") ? "market" : "unrelated";
  }
  return ranked[0][0];
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
    if (existing) {
      return {
        decision: existing,
        reused: true,
        shouldContinue: shouldFormIssue({
          relevance: existing.relevance,
          subjectRelation: existing.subjectRelation,
        }),
      };
    }

    const input = buildT02Input({ companyId, context, source, options: this.inputOptions });
    const callCount = this.inputOptions.dualCall ? (this.inputOptions.consensusCalls || 3) : 1;
    const passes = [];
    for (let i = 0; i < callCount; i += 1) {
      passes.push(await this._executeOnce({ tenantId, companyId, input }));
    }
    const merged = mergeRelevanceOutputs(...passes.map((p) => p.data));
    const bodyForGate = typeof source.article?.content === "string" ? source.article.content : "";
    const identity = applySubjectIdentityGate({
      ...merged,
      subjectRelation: merged.subject_relation,
      fields: context.fields,
      title: source.article?.title,
      summary: source.article?.summary,
      body: bodyForGate,
    });
    // Market materiality gate: topic/priority coincidence alone must not continue.
    // Peer commercial actions and region+project/regulation hooks remain valid.
    const materiality = applyMarketMaterialityGate({
      relevance: identity.relevance,
      confidence: identity.confidence,
      subjectRelation: identity.subjectRelation,
      fields: context.fields,
      title: source.article?.title,
      summary: source.article?.summary,
    });
    const output = {
      relevance: materiality.relevance,
      confidence: materiality.confidence,
      subjectRelation: identity.subjectRelation,
      competitorOptIn: identity.competitorOptIn,
      identityGate: {
        gated: Boolean(identity.gated),
        reason: identity.reason || null,
        selfHits: identity.selfHits || [],
        competitorHits: identity.competitorHits || [],
      },
      marketMaterialityGate: {
        gated: Boolean(materiality.gated),
        reason: materiality.reason || null,
        hook: materiality.hook || null,
        matched: materiality.matched || [],
      },
    };

    const provenance = {
      ...passes[0].provenance,
      consensusCalls: callCount,
      passes: passes.map((p) => p.data),
      merged: { relevance: merged.relevance, confidence: merged.confidence, subject_relation: merged.subject_relation },
      identityGate: output.identityGate,
      marketMaterialityGate: output.marketMaterialityGate,
    };
    const persistedOutput = {
      relevance: output.relevance,
      confidence: output.confidence,
      subject_relation: output.subjectRelation,
      competitor_opt_in: output.competitorOptIn,
    };

    const decision = await this.decisionStore.create({
      tenantId,
      articleId,
      companyId,
      contextVersion: context.version,
      inputFingerprint,
      source,
      output: persistedOutput,
      provenance,
    });

    return {
      decision,
      reused: false,
      shouldContinue: shouldFormIssue({
        relevance: decision.relevance,
        subjectRelation: decision.subjectRelation,
      }),
    };
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
    const completeness = context.completeness || evaluateContextCompleteness(context.fields);
    if (!completeness.complete) {
      throw incompleteContextError(completeness, { companyId, contextVersion: context.version });
    }
    if (!context.managementIdentity?.identity) {
      throw new AiConfigurationError("T02 requires a ready management identity for the effective Company Context", {
        details: { code: "MANAGEMENT_IDENTITY_REQUIRED", companyId, contextVersion: context.version },
      });
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
  // Bump when identity/materiality gate semantics change so stale continues are not reused.
  base.gateStack = "v16-management-identity";
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
