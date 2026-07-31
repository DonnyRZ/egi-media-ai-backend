"use strict";

const {
  MANAGEMENT_IDENTITY_PROMPT_ID,
  MANAGEMENT_IDENTITY_PROMPT_VERSION,
  MANAGEMENT_IDENTITY_VERSION,
} = require("./schema");
const { normalizeContextFieldsForRead } = require("../tasks/t01-company-context-draft/schema");

/**
 * Luna writes the leadership PERSONA from company context.
 * Company scope/facts stay in company_context.fields for downstream tasks.
 * Voice is singular second-person ("you") — one actor, not a collective "we".
 */
const SYSTEM_POLICY = [
  "You write the leadership-team persona of exactly one company.",
  "The persona is who the AI will act as: this company's own management / leadership.",
  "Write identity in singular second-person (you / your). Do not use we / our / us.",
  "Focus on the leadership role and strategic mandate — not on restating products, services, or capabilities.",
  "Company scope details live in company_context_fields and will be supplied separately to later tasks; do not duplicate them as the body of identity.",
  "Use company_context_fields only to ground the company name and domain.",
  "Return only the required JSON object.",
].join(" ");

function buildManagementIdentityDraftInput({ companyId = null, contextVersion = null, fields }) {
  const normalized = normalizeContextFieldsForRead(fields || {});
  const trustedContext = {
    company_id: companyId,
    company_context_version: contextVersion,
    company_context_fields: normalized,
  };

  const taskContract = {
    task_id: `${MANAGEMENT_IDENTITY_PROMPT_ID}@${MANAGEMENT_IDENTITY_PROMPT_VERSION}`,
    objective: "Write the leadership-team persona for the company in company_context_fields.",
    division_of_labor: {
      identity: "Who you are as leadership, and what you focus on strategically for this company.",
      company_context_fields: "Facts about the company (products, regions, customers, etc.). Later tasks receive both identity and context — identity must not replace context.",
    },
    meaning: {
      management: "This company's own leadership (CEO / management lens). Singular second-person voice only.",
      not: [
        "A company brochure or capability pitch",
        "A list of products, services, technologies, or offerings",
        "Management consulting or managed-services marketing copy",
        "A restatement of company_context_fields.description",
        "Collective we / our voice",
      ],
    },
    output_fields: {
      version: MANAGEMENT_IDENTITY_VERSION,
      company_name: "From company_context_fields.name when present.",
      identity: [
        "Leadership persona paragraph in you / your voice.",
        "Must establish: (1) You are the management / leadership of {company_name}.",
        "(2) You focus on strategic decisions for this company (position, risk, growth, material external signals).",
        "(3) At most one short clause naming the company's domain from fields — no service catalog.",
      ].join(" "),
      lens_summary: "One sentence in you-voice or neutral: leadership of {company_name} focused on strategic stewardship of this company.",
    },
    example_shape: "You are the management / leadership of {name}. You focus on strategic decisions that affect this company's position, risks, and growth. You lead a {industry} company.",
    rules: [
      "Use singular second-person (you / your) throughout identity. Never use we / our / us.",
      "Ground company_name and domain only in company_context_fields.",
      "Do not invent facts outside the fields.",
      "Do not enumerate products, services, tech stacks, or go-to-market offerings in identity.",
      "Omit meta labels such as fictional, demo, sample, or test.",
      "Keep identity concise (about 2-4 sentences).",
      "The first sentence must establish the leadership role with You are…",
    ],
  };

  return [
    { role: "system", content: SYSTEM_POLICY },
    {
      role: "user",
      content: [
        `<TASK_CONTRACT>${JSON.stringify(taskContract)}</TASK_CONTRACT>`,
        `<TRUSTED_CONTEXT>${JSON.stringify(trustedContext)}</TRUSTED_CONTEXT>`,
        "<OUTPUT_REQUIREMENT>Return only version, company_name, identity, and lens_summary in the required JSON Schema.</OUTPUT_REQUIREMENT>",
      ].join("\n"),
    },
  ];
}

module.exports = {
  SYSTEM_POLICY,
  buildManagementIdentityDraftInput,
};
