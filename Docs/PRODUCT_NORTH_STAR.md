# EGI Media AI — Product North Star

## Primary user

The primary user is the management team of the company selected in the dashboard.

## Job to be done

The dashboard turns external media into company-specific management intelligence.
It must answer:

> What external development should this management team care about, why does it
> matter to this company, and what should management watch or consider next?

It is not a general news timeline, and it is not an operational dashboard for the
company mentioned in an article.

## Relevance

An article may be material even when it never names the dashboard company.
Relevant external signals include:

- direct reporting about the company;
- moves by listed or unlisted competitors and peers;
- market, demand, supply-chain, technology, labour, policy, regulatory, and
  reputational developments that materially intersect the effective Company
  Context.

Unrelated entertainment, sport, generic news with no material Company Context
intersection, and unusable/thin content must stop.

## Analysis perspective

Every analysis is written for the dashboard company's management team.

- `self`: explain the direct consequence for the company.
- `competitor`: explain the competitive consequence and response options for the
  dashboard company.
- `market`: explain the opportunity, threat, or decision implication for the
  dashboard company.
- `unrelated`: must not form an issue.

For non-self evidence, never write recommendations as if management operates the
external article subject. Facts may describe the external entity; implications,
risks, and watch items must return to the dashboard company.

## Multi-tenant rule

All relevance and framing decisions use the effective `company_context.fields`
provided at runtime. Prompts, gates, tests, and rubrics must not hard-code a
tenant, brand, or industry.

## Change control

Changes to what can form an issue or whose perspective an analysis serves are
product-policy changes. They require validation against this document before
implementation. Technical audit loops may optimize only inside this boundary.
