const { PostgresRecordStore } = require("./postgres-record-store");
const stores = require("./postgres-stores");
function createPostgresPersistence({ db } = {}) { if (!db) throw new TypeError("PostgreSQL persistence requires the AI database adapter"); return { relevanceDecisionStore:new stores.PostgresRelevanceDecisionStore({db}), matchDecisionStore:new stores.PostgresIssueMatchDecisionStore({db}), analysisStore:new stores.PostgresIssueAnalysisStore({db}), priorityStore:new stores.PostgresIssuePriorityStore({db}) }; }
module.exports = { PostgresRecordStore, createPostgresPersistence, ...stores };
