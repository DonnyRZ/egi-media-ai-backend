const express = require("express");
const cookieParser = require("cookie-parser");
const swaggerUi = require("swagger-ui-express");
const path = require("path");
const http = require("http");

const config = require("../config/global_config");
const { validateEnvironment, validateProductionEnvironment } = require("../config/environment");
const { createDatabaseRuntime } = require("../database");
const { createHealthHandlers } = require("./health");
const { requestContextMiddleware } = require("./request-context");
const { errorMiddleware, sendError } = require("./error-contract");
const { createAuthContextMiddleware } = require("../auth/auth-context");
const corsMiddleware = require("./cors");
const registerRoutes = require("../routes");
const { createCompanyContextRuntime } = require("../company-context/runtime");
const { createT01CompanyContextDraftRuntime, t02RelevanceClass, t03RelevanceRationale, t04IssueMatch, t05IssueTitle, t06IssueOneLiner, t07IssueAnalysis, t08ClaimLabels, t09PriorityEnum, t10PriorityReason, t12DirectBlurbs, t13ReportNarrative, t14ConstrainedRewrite, createAiTaskKernel } = require("../ai");
const { createCmsSourceGate } = require("../cms");
const { InMemoryIssueStore, InMemorySavedIssueStore, createIssueMutationRuntime } = require("../issues");
const { CitationAnalysisGate } = require("../analysis");
const { ExecutiveSummaryService, IssueReadService } = require("../dashboard");
const { AlertEligibilityService, InMemoryAlertPreferenceStore, InMemoryAlertEventStore } = require("../alerts");
const { createEmailDeliveryRuntime, InMemoryRecipientStore, InMemoryEmailDeliveryStore } = require("../delivery");
const reports = require("../reports");
const { InMemoryReportDraftStore } = reports;
const { InMemoryJobStore, JobQueueService } = require("../queue");
const { InMemorySourceSnapshotStore, InMemoryWatermarkStore, IngestWorker } = require("../ingest");
const { createLogger, MetricsRegistry, observabilityMiddleware } = require("../observability");
const { InMemoryFeedbackStore } = require("../feedback");
const { createPostgresPersistence } = require("../persistence");

class Server {
  constructor() {
    this.app = express();
    this.host = config.get("/host");
    this.port = config.get("/port");
    this.httpServer = null;
    this.databaseRuntime = null;
    this.companyContextRuntime = null;
    this.companyContextDraftRuntime = null;
    this.cmsSourceGate = createCmsSourceGate();
    this.relevanceRuntime = null;
    this.rationaleRuntime = null;
    this.issueFormationRuntime = null;
    this.savedIssueStore = new InMemorySavedIssueStore();
    this.feedbackStore = new InMemoryFeedbackStore();
    this.analysisRuntime = null;
    this.priorityRuntime = null;
    this.dashboardRuntime = null;
    this.alertRuntime = null;
    this.directBlurbRuntime = null;
    this.emailDeliveryRuntime = null;
    this.reportRuntime = null;
    this.ingestRuntime = null;
    this.logger = createLogger({ service: process.env.SERVICE_NAME });
    this.metrics = new MetricsRegistry();
    this.stopping = false;
    this.stopPromise = null;

    this._middlewares();
    this._routes();
  }

  _middlewares() {
    this.app.use(corsMiddleware);
    this.app.use(requestContextMiddleware);
    this.app.use(createAuthContextMiddleware());
    this.app.use(express.json({ limit: "1mb" }));
    this.app.use(cookieParser());
    this.app.use(observabilityMiddleware({ logger: this.logger, metrics: this.metrics }));
    this.app.disable("x-powered-by");
  }

  _routes() {
    const health = createHealthHandlers({
      env: process.env,
      getDatabaseRuntime: () => {
        if (!this.databaseRuntime) this.databaseRuntime = createDatabaseRuntime();
        return this.databaseRuntime;
      },
    });
    this.app.get("/health/live", health.live);
    this.app.get("/health/ready", health.ready);
    this.app.get("/metrics", (req, res) => {
      if (process.env.METRICS_ENABLED !== "true") return sendError(res, req, Object.assign(new Error("Metrics disabled"), { code: "NOT_FOUND", statusCode: 404 }));
      res.type("text/plain").send(this.metrics.toPrometheus());
    });

    this.app.get("/", (_req, res) => {
      res.json({ success: true, service: "egi-media-ai-backend", status: "running" });
    });

    const swaggerFile = require(path.join(__dirname, "../../swagger_output.json"));
    this.app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerFile, {
      explorer: true,
      customSiteTitle: "EGI Media AI Backend API Docs",
    }));

    registerRoutes(this.app, {
      companyContextService: this._getCompanyContextRuntime().service,
      getCompanyContextDraftService: () => this._getCompanyContextDraftService(),
      cmsSourceGate: this.cmsSourceGate,
      getT02Service: () => this._getT02Service(),
      getT03Service: () => this._getT03Service(),
      getT04Service: () => this._getT04Service(),
      getIssueMutationService: () => this._getIssueMutationService(),
      getT05Service: () => this._getT05Service(),
      getT06Service: () => this._getT06Service(),
      getT07Service: () => this._getT07Service(),
      getT08Service: () => this._getT08Service(),
      getCitationGate: () => this._getCitationGate(),
      getT09Service: () => this._getT09Service(),
      getT10Service: () => this._getT10Service(),
      getExecutiveSummaryService: () => this._getExecutiveSummaryService(),
      getIssueReadService: () => this._getIssueReadService(),
      getSavedIssueStore: () => this._getSavedIssueStore(),
      getIssueStore: () => this._getIssueStore(),
      getAlertRuntime: () => this._getAlertRuntime(),
      getT12Service: () => this._getT12Service(),
      getEmailDeliveryService: () => this._getEmailDeliveryService(),
      getReportRuntime: () => this._getReportRuntime(),
      getIngestRuntime: () => this._getIngestRuntime(),
      getFeedbackStore: () => this._getFeedbackStore(),
    });

    this.app.use((_req, res) => {
      sendError(res, _req, Object.assign(new Error("Route not found"), { code: "NOT_FOUND", statusCode: 404 }));
    });
    this.app.use(errorMiddleware);
  }

  listen() {
    if (this.httpServer) return Promise.resolve(this.httpServer);
    this.httpServer = http.createServer(this.app);
    return new Promise((resolve, reject) => {
      const onError = (error) => { this.httpServer?.off("listening", onListening); reject(error); };
      const onListening = () => {
        this.httpServer.off("error", onError);
        const actualPort = this.httpServer.address().port;
        this.logger.info("server_started", { host: this.host, port: actualPort, swaggerPath: "/api-docs" });
        resolve(this.httpServer);
      };
      this.httpServer.once("error", onError);
      this.httpServer.once("listening", onListening);
      this.httpServer.listen(this.port, this.host);
    });
  }

  async start() {
    if (config.get("/env") === "production" || process.env.APP_REQUIRE_VALID_ENV === "true") {
      if (config.get("/env") === "production") validateProductionEnvironment(process.env);
      else validateEnvironment(process.env);
    }
    return this.listen();
  }

  async stop() {
    if (this.stopPromise) return this.stopPromise;
    this.stopping = true;
    this.stopPromise = (async () => {
      const activeServer = this.httpServer;
      if (activeServer) {
        await new Promise((resolve, reject) => activeServer.close((error) => error && error.code !== "ERR_SERVER_NOT_RUNNING" ? reject(error) : resolve()));
        this.httpServer = null;
      }
      if (this.databaseRuntime) await this.databaseRuntime.close();
      this.logger.info("server_stopped");
    })();
    return this.stopPromise;
  }

  getDatabaseRuntime() {
    if (!this.databaseRuntime) this.databaseRuntime = createDatabaseRuntime();
    return this.databaseRuntime;
  }

  _getCompanyContextRuntime() {
    if (!this.companyContextRuntime) {
      const persistence = this._getPersistenceRuntime();
      this.companyContextRuntime = createCompanyContextRuntime({ draftStore: persistence?.contextDraftStore, effectiveContextStore: persistence?.effectiveContextStore });
    }
    return this.companyContextRuntime;
  }

  _getCompanyContextDraftService() {
    if (!this.companyContextDraftRuntime) {
      this.companyContextDraftRuntime = createT01CompanyContextDraftRuntime({
        draftStore: this._getCompanyContextRuntime().draftStore,
        authorizeCompany: async ({ companyId, tenantId, actor, scopeTrusted }) => Boolean(
          companyId && tenantId && scopeTrusted === true && actor?.actorId,
        ),
      });
    }
    return this.companyContextDraftRuntime.service;
  }

  _getT02Service() {
    if (!this.relevanceRuntime) {
      this.relevanceRuntime = t02RelevanceClass.createT02RelevanceRuntime({
        aiTaskKernel: createAiTaskKernel(),
        openaiConfig: config.get("/openai"),
        cmsSourceGate: this.cmsSourceGate,
        decisionStore: this._getPersistenceRuntime()?.relevanceDecisionStore,
        getEffectiveContext: async (companyId) => this._getCompanyContextRuntime().effectiveContextStore.getEffective(companyId),
        authorizeCompany: async ({ companyId }) => Boolean(companyId),
      });
    }
    return this.relevanceRuntime.service;
  }

  _getT03Service() {
    if (!this.rationaleRuntime) {
      const t02 = this._getT02Service();
      this.rationaleRuntime = t03RelevanceRationale.createT03RelevanceRationaleRuntime({
        aiTaskKernel: createAiTaskKernel(),
        openaiConfig: config.get("/openai"),
        cmsSourceGate: this.cmsSourceGate,
        decisionStore: this.relevanceRuntime.decisionStore,
        rationaleStore: this._getPersistenceRuntime()?.rationaleStore,
        getCompanyContextVersion: async (companyId, version) => this._getCompanyContextRuntime().effectiveContextStore.getVersion(companyId, version),
        authorizeCompany: async ({ companyId }) => Boolean(companyId),
      });
    }
    return this.rationaleRuntime.service;
  }

  _getIssueFormationRuntime() {
    if (!this.issueFormationRuntime) {
      const t02 = this._getT02Service();
      const issueStore = this._getPersistenceRuntime()?.issueStore || new InMemoryIssueStore();
      const t04 = t04IssueMatch.createT04IssueMatchRuntime({
        aiTaskKernel: createAiTaskKernel(), openaiConfig: config.get("/openai"), cmsSourceGate: this.cmsSourceGate,
        decisionStore: this.relevanceRuntime.decisionStore, matchDecisionStore: this._getPersistenceRuntime()?.matchDecisionStore, issueCandidateStore: issueStore,
        authorizeCompany: async ({ tenantId, companyId }) => Boolean(tenantId && companyId),
      });
      const mutation = createIssueMutationRuntime({
        matchDecisionStore: t04.matchDecisionStore, relevanceDecisionStore: this.relevanceRuntime.decisionStore,
        issueStore, authorizeCompany: async ({ tenantId, companyId }) => Boolean(tenantId && companyId),
      });
      const t05 = t05IssueTitle.createT05IssueTitleRuntime({
        aiTaskKernel: createAiTaskKernel(), openaiConfig: config.get("/openai"), cmsSourceGate: this.cmsSourceGate,
        issueStore, matchDecisionStore: t04.matchDecisionStore, relevanceDecisionStore: this.relevanceRuntime.decisionStore,
        authorizeCompany: async ({ tenantId, companyId }) => Boolean(tenantId && companyId),
      });
      const t06 = t06IssueOneLiner.createT06IssueOneLinerRuntime({
        aiTaskKernel: createAiTaskKernel(), openaiConfig: config.get("/openai"), cmsSourceGate: this.cmsSourceGate,
        issueStore, matchDecisionStore: t04.matchDecisionStore, relevanceDecisionStore: this.relevanceRuntime.decisionStore,
        authorizeCompany: async ({ tenantId, companyId }) => Boolean(tenantId && companyId),
      });
      this.issueFormationRuntime = { issueStore, t04, mutation, t05, t06 };
    }
    return this.issueFormationRuntime;
  }
  _getIssueStore() { return this._getIssueFormationRuntime().issueStore; }
  _getPersistenceRuntime() {
    if (process.env.AI_PERSISTENCE_MODE !== "postgres") return null;
    if (!this.persistenceRuntime) {
      if (!this.databaseRuntime) this.databaseRuntime = createDatabaseRuntime();
      this.persistenceRuntime = createPostgresPersistence({ db: this.databaseRuntime.ai });
    }
    return this.persistenceRuntime;
  }
  _getSavedIssueStore() { return this._getPersistenceRuntime()?.savedIssueStore || this.savedIssueStore; }
  _getFeedbackStore() { return this._getPersistenceRuntime()?.feedbackStore || this.feedbackStore; }
  _getT04Service() { return this._getIssueFormationRuntime().t04.service; }
  _getIssueMutationService() { return this._getIssueFormationRuntime().mutation.service; }
  _getT05Service() { return this._getIssueFormationRuntime().t05.service; }
  _getT06Service() { return this._getIssueFormationRuntime().t06.service; }

  _getAnalysisRuntime() {
    if (!this.analysisRuntime) {
      const issueRuntime = this._getIssueFormationRuntime();
      const t07 = t07IssueAnalysis.createT07IssueAnalysisRuntime({
        aiTaskKernel: createAiTaskKernel(), openaiConfig: config.get("/openai"), cmsSourceGate: this.cmsSourceGate,
        issueStore: issueRuntime.issueStore, analysisStore: this._getPersistenceRuntime()?.analysisStore,
        getEffectiveContext: async (companyId) => this._getCompanyContextRuntime().effectiveContextStore.getEffective(companyId),
        authorizeCompany: async ({ tenantId, companyId }) => Boolean(tenantId && companyId),
      });
      const t08 = t08ClaimLabels.createT08ClaimLabelsRuntime({
        aiTaskKernel: createAiTaskKernel(), openaiConfig: config.get("/openai"), analysisStore: t07.analysisStore, labelStore: this._getPersistenceRuntime()?.labelStore,
        authorizeCompany: async ({ tenantId, companyId }) => Boolean(tenantId && companyId),
      });
      const gate = new CitationAnalysisGate({
        cmsSourceGate: this.cmsSourceGate, issueStore: issueRuntime.issueStore,
        analysisStore: t07.analysisStore, labelStore: t08.labelStore,
        authorizeCompany: async ({ tenantId, companyId }) => Boolean(tenantId && companyId),
      });
      this.analysisRuntime = { t07, t08, gate };
    }
    return this.analysisRuntime;
  }
  _getT07Service() { return this._getAnalysisRuntime().t07.service; }
  _getT08Service() { return this._getAnalysisRuntime().t08.service; }
  _getCitationGate() { return this._getAnalysisRuntime().gate; }

  _getPriorityRuntime() {
    if (!this.priorityRuntime) {
      const issueRuntime = this._getIssueFormationRuntime();
      const analysisRuntime = this._getAnalysisRuntime();
      const t09 = t09PriorityEnum.createT09PriorityEnumRuntime({
        aiTaskKernel: createAiTaskKernel(), openaiConfig: config.get("/openai"), issueStore: issueRuntime.issueStore,
        analysisStore: analysisRuntime.t07.analysisStore, priorityStore: this._getPersistenceRuntime()?.priorityStore,
        getEffectiveContext: async (companyId) => this._getCompanyContextRuntime().effectiveContextStore.getEffective(companyId),
        authorizeCompany: async ({ tenantId, companyId }) => Boolean(tenantId && companyId),
      });
      const t10 = t10PriorityReason.createT10PriorityReasonRuntime({
        aiTaskKernel: createAiTaskKernel(), openaiConfig: config.get("/openai"), issueStore: issueRuntime.issueStore,
        analysisStore: analysisRuntime.t07.analysisStore, priorityStore: t09.priorityStore, labelStore: analysisRuntime.t08.labelStore, reasonStore: this._getPersistenceRuntime()?.reasonStore,
        getEffectiveContext: async (companyId) => this._getCompanyContextRuntime().effectiveContextStore.getEffective(companyId),
        authorizeCompany: async ({ tenantId, companyId }) => Boolean(tenantId && companyId),
      });
      this.priorityRuntime = { t09, t10 };
    }
    return this.priorityRuntime;
  }
  _getT09Service() { return this._getPriorityRuntime().t09.service; }
  _getT10Service() { return this._getPriorityRuntime().t10.service; }

  _getDashboardRuntime() {
    if (!this.dashboardRuntime) {
      const issueRuntime = this._getIssueFormationRuntime();
      const analysisRuntime = this._getAnalysisRuntime();
      const priorityRuntime = this._getPriorityRuntime();
      const authorizeCompany = async ({ tenantId, companyId }) => Boolean(tenantId && companyId);
      this.dashboardRuntime = {
        executiveSummary: new ExecutiveSummaryService({ issueStore: issueRuntime.issueStore, analysisStore: analysisRuntime.t07.analysisStore, priorityStore: priorityRuntime.t09.priorityStore, authorizeCompany }),
        issueRead: new IssueReadService({ issueStore: issueRuntime.issueStore, analysisStore: analysisRuntime.t07.analysisStore, priorityStore: priorityRuntime.t09.priorityStore, authorizeCompany }),
      };
    }
    return this.dashboardRuntime;
  }
  _getExecutiveSummaryService() { return this._getDashboardRuntime().executiveSummary; }
  _getIssueReadService() { return this._getDashboardRuntime().issueRead; }

  _getAlertRuntime() {
    if (!this.alertRuntime) {
      const issueRuntime = this._getIssueFormationRuntime(); const analysisRuntime = this._getAnalysisRuntime(); const priorityRuntime = this._getPriorityRuntime();
      const preferenceStore = this._getPersistenceRuntime()?.alertPreferenceStore || new InMemoryAlertPreferenceStore(); const eventStore = this._getPersistenceRuntime()?.alertEventStore || new InMemoryAlertEventStore();
      this.alertRuntime = { preferenceStore, eventStore, service: new AlertEligibilityService({ issueStore: issueRuntime.issueStore, analysisStore: analysisRuntime.t07.analysisStore, priorityStore: priorityRuntime.t09.priorityStore, reasonStore: priorityRuntime.t10.reasonStore, preferenceStore, eventStore, authorizeCompany: async ({ tenantId, companyId }) => Boolean(tenantId && companyId) }) };
    }
    return this.alertRuntime;
  }
  _getT12Service() {
    if (!this.directBlurbRuntime) {
      const issueRuntime = this._getIssueFormationRuntime(); const analysisRuntime = this._getAnalysisRuntime(); const priorityRuntime = this._getPriorityRuntime(); const alertRuntime = this._getAlertRuntime();
      this.directBlurbRuntime = t12DirectBlurbs.createT12DirectBlurbsRuntime({
        aiTaskKernel: createAiTaskKernel(), openaiConfig: config.get("/openai"), eventStore: alertRuntime.eventStore,
        issueStore: issueRuntime.issueStore, analysisStore: analysisRuntime.t07.analysisStore, priorityStore: priorityRuntime.t09.priorityStore,
        reasonStore: priorityRuntime.t10.reasonStore, blurbStore: this._getPersistenceRuntime()?.blurbStore, authorizeCompany: async ({ tenantId, companyId }) => Boolean(tenantId && companyId),
      });
    }
    return this.directBlurbRuntime.service;
  }
  _getEmailDeliveryService() {
    if (!this.emailDeliveryRuntime) {
      const issueRuntime = this._getIssueFormationRuntime(); const analysisRuntime = this._getAnalysisRuntime(); const alertRuntime = this._getAlertRuntime(); const t12Runtime = this._getDirectBlurbRuntime();
      this.emailDeliveryRuntime = createEmailDeliveryRuntime({
        eventStore: alertRuntime.eventStore, blurbStore: t12Runtime.blurbStore, issueStore: issueRuntime.issueStore,
        analysisStore: analysisRuntime.t07.analysisStore, recipientStore: new InMemoryRecipientStore(), deliveryStore: this._getPersistenceRuntime()?.deliveryStore || new InMemoryEmailDeliveryStore(),
        authorizeCompany: async ({ tenantId, companyId }) => Boolean(tenantId && companyId),
      });
    }
    return this.emailDeliveryRuntime.service;
  }
  _getDirectBlurbRuntime() {
    if (!this.directBlurbRuntime) this._getT12Service();
    return this.directBlurbRuntime;
  }
  _getReportRuntime() {
    if (!this.reportRuntime) {
      const draftStore = this._getPersistenceRuntime()?.reportDraftStore || new InMemoryReportDraftStore();
      const narrativeRuntime = t13ReportNarrative.createT13ReportNarrativeRuntime({
        aiTaskKernel: createAiTaskKernel(), openaiConfig: config.get("/openai"), reportDraftStore: draftStore, narrativeStore: this._getPersistenceRuntime()?.reportNarrativeStore,
        authorizeCompany: async ({ tenantId, companyId }) => Boolean(tenantId && companyId),
      });
      const shareIntents = [];
      const lifecycleService = new reports.ReportLifecycleService({
        reportDraftStore: draftStore, narrativeStore: narrativeRuntime.narrativeStore,
        authorizeReportAction: async ({ actor, tenantId, companyId }) => Boolean(actor?.actorType === "human" && actor?.actorId && tenantId && companyId),
        sharePublisher: { share: async ({ report, actor, shareTarget }) => { shareIntents.push({ reportId: report.reportId, actorId: actor.actorId, recipientRefsHash: shareTarget?.recipientRefs ? shareTarget.recipientRefs.length : 0 }); } },
      });
      const rewriteRuntime = t14ConstrainedRewrite.createT14ConstrainedRewriteRuntime({
        aiTaskKernel: createAiTaskKernel(), openaiConfig: config.get("/openai"), reportDraftStore: draftStore, narrativeStore: narrativeRuntime.narrativeStore,
        authorizeCompany: async ({ actor, tenantId, companyId }) => Boolean(actor?.actorType === "human" && actor?.actorId && tenantId && companyId),
      });
      this.reportRuntime = { draftStore, narrativeService: narrativeRuntime.service, narrativeRuntime, narrativeStore: narrativeRuntime.narrativeStore, lifecycleService, shareIntents, rewriteService: rewriteRuntime.service, rewriteRuntime };
    }
    return this.reportRuntime;
  }
  _getIngestRuntime() {
    if (!this.ingestRuntime) {
      const persistence = this._getPersistenceRuntime(); const jobStore = persistence?.jobStore || new InMemoryJobStore(); const queue = new JobQueueService({ jobStore, workerId: "ingest-worker" }); const snapshotStore = persistence?.snapshotStore || new InMemorySourceSnapshotStore(); const watermarkStore = persistence?.watermarkStore || new InMemoryWatermarkStore();
      const worker = new IngestWorker({ sourceGate: this.cmsSourceGate, articleListClient: this.cmsSourceGate.cmsArticleClient, snapshotStore, watermarkStore, enqueueStageJob: async ({ tenantId, companyId, stage, sourceSnapshotId, sourceArticleId, locale }) => queue.enqueue({ tenantId, companyId, queueName: "pipeline-stage", jobType: `${stage}.dispatch`, idempotencyKey: `stage-${sourceSnapshotId}-${companyId}`.slice(0, 255), payload: { stage, source_snapshot_id: sourceSnapshotId, source_article_id: sourceArticleId, locale }, maxAttempts: 3 }) });
      const runNext = () => queue.processNext({ queueName: "ingest", handler: (job) => job.payload.mode === "article" ? worker.triggerArticle({ tenantId: job.tenantId, companyId: job.companyId, articleId: job.payload.article_id, locale: job.payload.locale }) : worker.poll({ tenantId: job.tenantId, companyId: job.companyId, locale: job.payload.locale, limit: job.payload.limit }) });
      this.ingestRuntime = { queue, jobStore, worker, snapshotStore, watermarkStore, runNext };
    }
    return this.ingestRuntime;
  }
}

module.exports = Server;
