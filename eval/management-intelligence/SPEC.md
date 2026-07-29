# Management Intelligence Audit Loop

This specification implements `docs/PRODUCT_NORTH_STAR.md`.

## Required scenarios

Each audit set must include multiple industries and all of:

1. a material move by an unlisted peer (must continue as `market`);
2. a material move by a listed competitor (must continue as `competitor`);
3. a material regulation or market shift that does not name the dashboard company
   (must continue as `market`);
4. a weak same-industry mention with no concrete implication (must stop as low);
5. unrelated news and thin/placeholder content (must stop);
6. analysis of non-self evidence (must describe external facts, but impacts, risks,
   and watch items must address the dashboard company's management).

## Live-model loop

For each iteration:

1. Run T02 production prompt against the scenario matrix.
2. Run each continuing scenario through T07 generation and the independent
   management-perspective review.
3. Record raw model output, review verdict, corrected output, and token usage.
4. Diagnose every miss; change generic prompt/policy only.
5. Repeat the full matrix. Do not report success from deterministic mocks alone.

## Pass criteria

- unrelated/thin continuation: 0;
- material peer/competitor/regulation miss: 0;
- issue/no-issue branch flips across repeated calls: 0;
- `subject_relation` flips for issue-forming outputs: 0 (the exact market/unrelated
  label on stopped low/none content is non-operative and is reported separately);
- non-self analysis addressed to the external entity's management: 0;
- unsupported dashboard-company facts: 0;
- all outputs valid and cited;
- no tenant or industry hard-coding under `src/ai/`;
- production false positives in `production-cases.json` (FP-*): 0 continues;
- production true positives (TP-*): 0 stops;
- live eval must use production-matching T02 input options (`includeBodySnippet` false
  unless production enables it). Success on synthetic scenarios alone is insufficient.

