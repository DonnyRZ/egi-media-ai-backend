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
const { CrawlIngestService, createIssueSourceResolver } = require("../source");
const { createCrawlArticleReader } = require("../news-feed/crawl-article-reader");
const { createNewsFeedService } = require("../news-feed/news-feed.service");
const { InMemoryIssueStore, InMemorySavedIssueStore, createIssueMutationRuntime } = require("../issues");
const { CitationAnalysisGate } = require("../analysis");
const { ExecutiveSummaryService, IssueReadService } = require("../dashboard");
const { AlertEligibilityService, InMemoryAlertPreferenceStore, InMemoryAlertEventStore } = require("../alerts");
const { createEmailDeliveryRuntime, InMemoryRecipientStore, InMemoryEmailDeliveryStore } = require("../delivery");
const reports = require("../reports");
const { InMemoryReportDraftStore } = reports;
const { InMemoryJobStore, JobQueueService } = require("../queue");
const { InMemorySourceSnapshotStore, InMemoryWatermarkStore, IngestWorker } = require("../ingest");
const { SchedulerStateStore } = require("../automation/scheduler-state");
const { PollEnqueueService } = require("../automation/poll-enqueue.service");
const { MultiTenantIngestScheduler } = require("../automation/scheduler");
const { QueueWorkerRunner } = require("../automation/worker-runner");
const { resolveAutomationStart } = require("../automation/start-policy");
const {
  InMemoryAutomaticIntakeSettingsStore,
  FileAutomaticIntakeSettingsStore,
  PostgresAutomaticIntakeSettingsStore,
  defaultAutomaticIntakeSettingsPath,
} = require("../automation/automatic-intake-settings.store");
const { AutomaticIntakeController } = require("../automation/automatic-intake.controller");
const { listRecentRunsFromStore } = require("../routes/news-intake");
const { InMemoryPipelineCompanyStore, PostgresPipelineCompanyStore } = require("../automation/company-scope");
const { PipelineStageDispatcher } = require("../automation/pipeline-stage-dispatcher");
const { AiTaskRegistry, AiPipelineWorker, InMemoryPipelineStateStore } = require("../pipeline");
const { AutomationDownstreamBoundary } = require("../automation/downstream-boundary");
const { createLogger, MetricsRegistry, observabilityMiddleware } = require("../observability");
const { createPostgresPersistence } = require("../persistence");
const { AuthorizationService } = require("../auth/authorization");
const { InMemoryMembershipStore } = require("../auth/membership.store");
const { InMemoryAccessAuditStore } = require("../auth/audit.store");
const { InMemoryTenantStore, PostgresTenantStore } = require("../auth/tenant.store");
const { InMemoryCompanyStore, PostgresCompanyStore } = require("../auth/provisioning.store");
const { InMemoryPlatformOperatorStore, PostgresPlatformOperatorStore } = require("../auth/platform.store");
const { LocalAuthService } = require("../auth/local-auth");
const { InMemoryCompanyContextUploadRequestStore } = require("../company-context/upload-request.store");

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
    this.crawlArticleReader = null;
    this.issueSourceResolver = null;
    this.newsFeedService = null;
    this.relevanceRuntime = null;
    this.rationaleRuntime = null;
    this.issueFormationRuntime = null;
    this.savedIssueStore = new InMemorySavedIssueStore();
    this.analysisRuntime = null;
    this.priorityRuntime = null;
    this.dashboardRuntime = null;
    this.alertRuntime = null;
    this.directBlurbRuntime = null;
    this.emailDeliveryRuntime = null;
    this.reportRuntime = null;
    this.ingestRuntime = null;
    this.schedulerStateStore = new SchedulerStateStore();
    this.scheduler = null;
    this.workerRunner = null;
    this.automaticIntakeSettingsStore = null;
    this.automaticIntakeController = null;
    this.automationRuntimeConfig = null;
    this.pipelineRuntime = null;
    this.logger = createLogger({ service: process.env.SERVICE_NAME });
    this.app.locals.logger = this.logger;
    this.metrics = new MetricsRegistry();
    this.membershipStore = process.env.AI_PERSISTENCE_MODE === "postgres" && process.env.AI_LOCAL_PREVIEW_AUTH !== "true"
      ? {
        resolve: (args) => this._getPersistenceRuntime().membershipStore.resolve(args),
        list: (args) => this._getPersistenceRuntime().membershipStore.list(args),
        listForUser: (args) => this._getPersistenceRuntime().membershipStore.listForUser(args),
        invite: (args) => this._getPersistenceRuntime().membershipStore.invite(args),
        activateByUser: (args) => this._getPersistenceRuntime().membershipStore.activateByUser(args),
        update: (args) => this._getPersistenceRuntime().membershipStore.update(args),
        revoke: (args) => this._getPersistenceRuntime().membershipStore.revoke(args),
      }
      : new InMemoryMembershipStore({ memberships: process.env.AI_LOCAL_PREVIEW_AUTH === "true" ? [
        { userId: "dummy-actor", tenantId: "dummy-tenant", companyId: null, role: "tenant_admin" },
        { userId: "ai-worker-local", tenantId: "dummy-tenant", companyId: null, role: "ai_worker" },
        { userId: "ai-worker-local", tenantId: "system", companyId: "source-ingest", role: "ai_worker" },
      ] : [] });
    this.accessAuditStore = process.env.AI_PERSISTENCE_MODE === "postgres"
      ? { record: (input) => this._getPersistenceRuntime().accessAuditStore.record(input) }
      : new InMemoryAccessAuditStore();
    this.app.locals.accessAuditStore = this.accessAuditStore;
    this.tenantStore = process.env.AI_PERSISTENCE_MODE === "postgres"
      ? { get: (args) => new PostgresTenantStore({ db: this.getDatabaseRuntime().ai }).get(args), list: (args) => new PostgresTenantStore({ db: this.getDatabaseRuntime().ai }).list(args), create: (args) => new PostgresTenantStore({ db: this.getDatabaseRuntime().ai }).create(args), update: (args) => new PostgresTenantStore({ db: this.getDatabaseRuntime().ai }).update(args) }
      : new InMemoryTenantStore();
    this.companyStore = process.env.AI_PERSISTENCE_MODE === "postgres"
      ? { get: (args) => new PostgresCompanyStore({ db: this.getDatabaseRuntime().ai }).get(args), list: (args) => new PostgresCompanyStore({ db: this.getDatabaseRuntime().ai }).list(args), create: (args) => new PostgresCompanyStore({ db: this.getDatabaseRuntime().ai }).create(args), update: (args) => new PostgresCompanyStore({ db: this.getDatabaseRuntime().ai }).update(args) }
      : new InMemoryCompanyStore();
    this.tenantStore.update = this.tenantStore.update?.bind(this.tenantStore);
    this.platformStore = process.env.AI_PERSISTENCE_MODE === "postgres"
      ? {
        resolve: (args) => new PostgresPlatformOperatorStore({ db: this.getDatabaseRuntime().ai }).resolve(args),
        upsert: (args) => new PostgresPlatformOperatorStore({ db: this.getDatabaseRuntime().ai }).upsert(args),
      }
      : new InMemoryPlatformOperatorStore();
    const accountStore = process.env.AI_PERSISTENCE_MODE === "postgres" ? {
      find: async (email) => { const result = await this.getDatabaseRuntime().ai.query("SELECT id,email,full_name,status,password_hash FROM ai.users WHERE email=$1 AND status='active'", [email]); const row = result.rows[0]; return row ? { email: row.email, fullName: row.full_name, role: null, actorType: "human", passwordHash: row.password_hash } : null; },
      save: async ({ userId, email, fullName, passwordHash }) => { await this.getDatabaseRuntime().ai.query("INSERT INTO ai.users (id,email,full_name,status,password_hash) VALUES ($1,$2,$3,'active',$4) ON CONFLICT (email) DO UPDATE SET full_name=EXCLUDED.full_name,password_hash=EXCLUDED.password_hash,status='active',updated_at=now()", [userId, email, fullName, passwordHash]); },
    } : null;
    this.localAuthService = new LocalAuthService({ email: config.get("/auth/bootstrapAdminEmail"), password: config.get("/auth/bootstrapAdminPassword"), secret: config.get("/auth/accessTokenSecret"), accountStore });
    this.platformBootstrapPromise = this.platformStore.upsert?.({ userId: `user:${String(config.get("/auth/bootstrapAdminEmail")).toLowerCase()}`, role: "platform_superadmin" }) || Promise.resolve();
    this.authorizationService = new AuthorizationService({ membershipStore: this.membershipStore, platformStore: this.platformStore, auditStore: this.accessAuditStore, logger: this.logger, strictMembership: config.get("/env") === "production" || process.env.AI_PERSISTENCE_MODE === "postgres" });
    this.app.locals.authorizationService = this.authorizationService;
    this.app.locals.membershipStore = this.membershipStore;
    this.app.locals.platformStore = this.platformStore;
    this.app.locals.localAuthService = this.localAuthService;
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
      getCompanyContextUploadStore: () => this._getPersistenceRuntime()?.uploadRequestStore || (this.companyContextUploadStore ||= new InMemoryCompanyContextUploadRequestStore()),
      cmsSourceGate: this.cmsSourceGate,
      getIssueSourceResolver: () => this._getIssueSourceResolver(),
      getNewsFeedService: () => this._getNewsFeedService(),
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
      getMembershipStore: () => this._getMembershipStore(),
      getTenantStore: () => this.tenantStore,
      getCompanyStore: () => this.companyStore,
      getAutomationStatus: async () => this._getAutomationStatusPayload(),
      setAutomaticIntake: async ({ desired, actorId, role } = {}) => {
        if (!this.automaticIntakeController) {
          throw Object.assign(new Error("Automatic intake management is not available"), {
            code: "SERVICE_UNAVAILABLE",
            statusCode: 503,
          });
        }
        return this.automaticIntakeController.setDesired(desired, { actorId, role });
      },
      getAutomationJobs: async (req) => this._getIngestRuntime().jobStore.list({ tenantId: req.authContext.tenantId, companyId: req.authContext.companyId, status: req.query.status || undefined }),
      getNewsIntakeRecentRuns: async (req, query = {}) => listRecentRunsFromStore(this._getIngestRuntime().jobStore, {
        tenantId: req.authContext.tenantId,
        companyId: req.authContext.companyId,
        ...query,
      }),
      assertIntakeReady: async ({ tenantId, companyId }) => {
        const { assertManagementIdentityReady } = require("../ai/identity");
        await assertManagementIdentityReady({
          effectiveContextStore: this._getCompanyContextRuntime().effectiveContextStore,
          identityStore: this._getManagementIdentityRuntime().identityStore,
          tenantId,
          companyId,
        });
      },
      getIntakeReadiness: async ({ tenantId, companyId }) => {
        const { resolveManagementIdentityReadiness } = require("../ai/identity");
        return resolveManagementIdentityReadiness({
          effectiveContextStore: this._getCompanyContextRuntime().effectiveContextStore,
          identityStore: this._getManagementIdentityRuntime().identityStore,
          tenantId,
          companyId,
        });
      },
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
    await this.platformBootstrapPromise;
    const result = await this.listen();
    await this._startAutomation();
    return result;
  }

  async stop() {
    if (this.stopPromise) return this.stopPromise;
    this.stopping = true;
    this.stopPromise = (async () => {
      this.scheduler?.stop();
      this.workerRunner?.stop();
      const activeServer = this.httpServer;
      if (activeServer) {
        await new Promise((resolve, reject) => activeServer.close((error) => error && error.code !== "ERR_SERVER_NOT_RUNNING" ? reject(error) : resolve()));
        this.httpServer = null;
      }
      if (this.persistenceRuntime?.issueStore?.ready) await this.persistenceRuntime.issueStore.ready.catch(() => undefined);
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
      const identityRuntime = this._getManagementIdentityRuntime();
      this.companyContextRuntime = createCompanyContextRuntime({
        draftStore: persistence?.contextDraftStore,
        effectiveContextStore: persistence?.effectiveContextStore,
        managementIdentityService: identityRuntime?.service || null,
        authorize: async ({ actor, tenantId, companyId, action }) => {
          try {
            await this.authorizationService.authorize({ actor, tenantId, companyId }, action);
            return true;
          } catch (_error) {
            return false;
          }
        },
      });
    }
    return this.companyContextRuntime;
  }

  _getManagementIdentityRuntime() {
    if (!this.managementIdentityRuntime) {
      const persistence = this._getPersistenceRuntime();
      const { createManagementIdentityRuntime } = require("../ai/identity");
      this.managementIdentityRuntime = createManagementIdentityRuntime({
        aiTaskKernel: createAiTaskKernel(),
        openaiConfig: config.get("/openai"),
        identityStore: persistence?.managementIdentityStore || undefined,
      });
    }
    return this.managementIdentityRuntime;
  }

  _getEffectiveFullContext(companyId, tenantId = null) {
    const { getEffectiveFullContext } = require("../ai/identity");
    return getEffectiveFullContext({
      getEffectiveContext: (id, tid) => this._getCompanyContextRuntime().effectiveContextStore.getEffective(id, tid),
      identityStore: this._getManagementIdentityRuntime().identityStore,
      companyId,
      tenantId,
    });
  }

  _getFullContextByVersion(companyId, version, tenantId = null) {
    const { getFullContextByVersion } = require("../ai/identity");
    return getFullContextByVersion({
      getContextVersion: (id, ver, tid) => this._getCompanyContextRuntime().effectiveContextStore.getVersion(id, ver, tid),
      identityStore: this._getManagementIdentityRuntime().identityStore,
      companyId,
      contextVersion: version,
      tenantId,
    });
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
        cmsSourceGate: this._getIssueSourceResolver(),
        decisionStore: this._getPersistenceRuntime()?.relevanceDecisionStore,
        getEffectiveContext: async (companyId, tenantId) => this._getEffectiveFullContext(companyId, tenantId),
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
        cmsSourceGate: this._getIssueSourceResolver(),
        decisionStore: this.relevanceRuntime.decisionStore,
        rationaleStore: this._getPersistenceRuntime()?.rationaleStore,
        companyStore: this.companyStore,
        getCompanyContextVersion: async (companyId, version, tenantId) => this._getFullContextByVersion(companyId, version, tenantId),
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
        aiTaskKernel: createAiTaskKernel(), openaiConfig: config.get("/openai"), cmsSourceGate: this._getIssueSourceResolver(),
        decisionStore: this.relevanceRuntime.decisionStore, matchDecisionStore: this._getPersistenceRuntime()?.matchDecisionStore, issueCandidateStore: issueStore,
        authorizeCompany: async ({ tenantId, companyId }) => Boolean(tenantId && companyId),
      });
      const mutation = createIssueMutationRuntime({
        matchDecisionStore: t04.matchDecisionStore, relevanceDecisionStore: this.relevanceRuntime.decisionStore,
        issueStore, authorizeCompany: async ({ tenantId, companyId }) => Boolean(tenantId && companyId),
      });
      const getEffectiveContext = async (companyId, tenantId) => this._getEffectiveFullContext(companyId, tenantId);
      const t05 = t05IssueTitle.createT05IssueTitleRuntime({
        aiTaskKernel: createAiTaskKernel(), openaiConfig: config.get("/openai"), cmsSourceGate: this._getIssueSourceResolver(),
        issueStore, matchDecisionStore: t04.matchDecisionStore, relevanceDecisionStore: this.relevanceRuntime.decisionStore,
        companyStore: this.companyStore,
        getEffectiveContext,
        authorizeCompany: async ({ tenantId, companyId }) => Boolean(tenantId && companyId),
      });
      const t06 = t06IssueOneLiner.createT06IssueOneLinerRuntime({
        aiTaskKernel: createAiTaskKernel(), openaiConfig: config.get("/openai"), cmsSourceGate: this._getIssueSourceResolver(),
        issueStore, matchDecisionStore: t04.matchDecisionStore, relevanceDecisionStore: this.relevanceRuntime.decisionStore,
        companyStore: this.companyStore,
        getEffectiveContext,
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
  _getMembershipStore() { return this.membershipStore; }
  _getT04Service() { return this._getIssueFormationRuntime().t04.service; }
  _getIssueMutationService() { return this._getIssueFormationRuntime().mutation.service; }
  _getT05Service() { return this._getIssueFormationRuntime().t05.service; }
  _getT06Service() { return this._getIssueFormationRuntime().t06.service; }

  _getAnalysisRuntime() {
    if (!this.analysisRuntime) {
      const issueRuntime = this._getIssueFormationRuntime();
      const t07 = t07IssueAnalysis.createT07IssueAnalysisRuntime({
        aiTaskKernel: createAiTaskKernel(), openaiConfig: config.get("/openai"), cmsSourceGate: this._getIssueSourceResolver(),
        issueStore: issueRuntime.issueStore, analysisStore: this._getPersistenceRuntime()?.analysisStore,
        relevanceDecisionStore: this.relevanceRuntime.decisionStore,
        companyStore: this.companyStore,
        getEffectiveContext: async (companyId, tenantId) => this._getEffectiveFullContext(companyId, tenantId),
        enablePerspectiveReview: process.env.T07_PERSPECTIVE_REVIEW !== "0",
        authorizeCompany: async ({ tenantId, companyId }) => Boolean(tenantId && companyId),
      });
      const t08 = t08ClaimLabels.createT08ClaimLabelsRuntime({
        aiTaskKernel: createAiTaskKernel(), openaiConfig: config.get("/openai"), analysisStore: t07.analysisStore, labelStore: this._getPersistenceRuntime()?.labelStore,
        authorizeCompany: async ({ tenantId, companyId }) => Boolean(tenantId && companyId),
      });
      const gate = new CitationAnalysisGate({
        cmsSourceGate: this._getIssueSourceResolver(), issueStore: issueRuntime.issueStore,
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
        getEffectiveContext: async (companyId, tenantId) => this._getEffectiveFullContext(companyId, tenantId),
        authorizeCompany: async ({ tenantId, companyId }) => Boolean(tenantId && companyId),
      });
      const t10 = t10PriorityReason.createT10PriorityReasonRuntime({
        aiTaskKernel: createAiTaskKernel(), openaiConfig: config.get("/openai"), issueStore: issueRuntime.issueStore,
        analysisStore: analysisRuntime.t07.analysisStore, priorityStore: t09.priorityStore, labelStore: analysisRuntime.t08.labelStore, reasonStore: this._getPersistenceRuntime()?.reasonStore,
        companyStore: this.companyStore,
        getEffectiveContext: async (companyId, tenantId) => this._getEffectiveFullContext(companyId, tenantId),
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

  _getCrawlArticleReader() {
    if (!this.crawlArticleReader) this.crawlArticleReader = createCrawlArticleReader();
    return this.crawlArticleReader;
  }

  _getIssueSourceResolver() {
    if (!this.issueSourceResolver) {
      this.issueSourceResolver = createIssueSourceResolver({
        cmsSourceGate: this.cmsSourceGate,
        crawlArticleReader: this._getCrawlArticleReader(),
      });
    }
    return this.issueSourceResolver;
  }

  _getNewsFeedService() {
    if (!this.newsFeedService) {
      this.newsFeedService = createNewsFeedService({
        crawlArticleReader: this._getCrawlArticleReader(),
        cmsArticleClient: this.cmsSourceGate.cmsArticleClient,
        portalBaseUrl: config.get("/portal").baseUrl,
      });
    }
    return this.newsFeedService;
  }

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
        reasonStore: priorityRuntime.t10.reasonStore, blurbStore: this._getPersistenceRuntime()?.blurbStore,
        companyStore: this.companyStore,
        getEffectiveContext: async (companyId, tenantId) => this._getEffectiveFullContext(companyId, tenantId),
        authorizeCompany: async ({ tenantId, companyId }) => Boolean(tenantId && companyId),
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
        logger: this.logger,
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
        companyStore: this.companyStore,
        getCompanyContextVersion: async (companyId, version, tenantId) => this._getFullContextByVersion(companyId, version, tenantId),
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
        companyStore: this.companyStore,
        authorizeCompany: async ({ actor, tenantId, companyId }) => Boolean(actor?.actorType === "human" && actor?.actorId && tenantId && companyId),
      });
      this.reportRuntime = { draftStore, narrativeService: narrativeRuntime.service, narrativeRuntime, narrativeStore: narrativeRuntime.narrativeStore, lifecycleService, shareIntents, rewriteService: rewriteRuntime.service, rewriteRuntime };
    }
    return this.reportRuntime;
  }
  _getIngestRuntime() {
    if (!this.ingestRuntime) {
      const persistence = this._getPersistenceRuntime(); const jobStore = persistence?.jobStore || new InMemoryJobStore(); const queue = new JobQueueService({ jobStore, workerId: "ingest-worker", logger: this.logger }); const snapshotStore = persistence?.snapshotStore || new InMemorySourceSnapshotStore(); const watermarkStore = persistence?.watermarkStore || new InMemoryWatermarkStore();
      const enqueueStageJob = async ({ tenantId, companyId, stage, sourceSnapshotId, sourceArticleId, locale }) => queue.enqueue({ tenantId, companyId, queueName: "pipeline-stage", jobType: `${stage}.dispatch`, idempotencyKey: `stage-${sourceSnapshotId}-${companyId}`.slice(0, 255), payload: { stage, source_snapshot_id: sourceSnapshotId, source_article_id: sourceArticleId, locale }, maxAttempts: 3 });
      const worker = new IngestWorker({ sourceGate: this._getIssueSourceResolver(), articleListClient: this.cmsSourceGate.cmsArticleClient, snapshotStore, watermarkStore, enqueueStageJob, logger: this.logger });
      const crawlIngestService = new CrawlIngestService({ crawlArticleReader: this._getCrawlArticleReader(), sourceGate: this._getIssueSourceResolver(), snapshotStore, watermarkStore, enqueueStageJob, logger: this.logger });
      const runNext = () => queue.processNext({ queueName: "ingest", handler: (job) => job.payload.mode === "crawl-poll" ? crawlIngestService.pollSource({ tenantId: job.tenantId, companyId: job.companyId, sourceId: job.payload.crawl_source_id, locale: job.payload.locale, limit: job.payload.limit }) : job.payload.mode === "article" ? worker.triggerArticle({ tenantId: job.tenantId, companyId: job.companyId, articleId: job.payload.article_id, locale: job.payload.locale }) : worker.poll({ tenantId: job.tenantId, companyId: job.companyId, locale: job.payload.locale, limit: job.payload.limit }) });
      this.ingestRuntime = { queue, jobStore, worker, crawlIngestService, snapshotStore, watermarkStore, runNext };
    }
    return this.ingestRuntime;
  }

  _createAutomaticIntakeSettingsStore() {
    if (process.env.AI_PERSISTENCE_MODE === "postgres") {
      return new PostgresAutomaticIntakeSettingsStore({ db: this.getDatabaseRuntime().ai });
    }
    if (process.env.AI_AUTOMATIC_INTAKE_SETTINGS_MODE === "memory") {
      return new InMemoryAutomaticIntakeSettingsStore();
    }
    return new FileAutomaticIntakeSettingsStore({
      filePath: defaultAutomaticIntakeSettingsPath(process.env),
    });
  }

  async _getAutomationStatusPayload() {
    const automation = this.automationRuntimeConfig || config.get("/automation");
    const start = resolveAutomationStart(automation);
    const automatic_intake = this.automaticIntakeController
      ? await this.automaticIntakeController.getStatus()
      : {
        desired: Boolean(automation?.enabled),
        actual_running: Boolean(this.scheduler?.running),
        interval_ms: automation?.intervalMs ?? null,
        batch_size: automation?.batchSize ?? null,
        locales: automation?.locales || [],
        last_enqueue_at: null,
        last_enqueue_status: null,
        last_error_code: null,
        last_job_id: null,
        desired_source: null,
        desired_updated_at: null,
      };
    return {
      automatic_intake,
      scheduler: this.scheduler?.status() || {
        running: Boolean(automatic_intake.actual_running),
        enabled: Boolean(automatic_intake.desired),
        interval_ms: automatic_intake.interval_ms,
        locales: automatic_intake.locales,
      },
      worker: this.workerRunner?.status() || { running: false },
      workers_enabled: start.startWorkers,
      pipeline: { configured: Boolean(this.pipelineRuntime) },
    };
  }

  async _startAutomation() {
    const envAutomation = config.get("/automation");
    const automation = { ...envAutomation };
    this.automationRuntimeConfig = automation;
    this.automaticIntakeSettingsStore = this._createAutomaticIntakeSettingsStore();
    this.automaticIntakeController = new AutomaticIntakeController({
      settingsStore: this.automaticIntakeSettingsStore,
      getScheduler: () => this.scheduler,
      getAutomationConfig: () => this.automationRuntimeConfig,
      envDefaultEnabled: Boolean(envAutomation.enabled),
      logger: this.logger,
    });
    // Persisted desired wins; AI_SCHEDULER_ENABLED is the seed only when none exists.
    automation.enabled = await this.automaticIntakeController.resolveDesiredOnBoot();

    const ingest = this._getIngestRuntime();
    const pipeline = this._getPipelineRuntime();
    const pollEnqueue = new PollEnqueueService({ queue: ingest.queue, maxAttempts: automation.maxAttempts });
    this.scheduler = new MultiTenantIngestScheduler({ config: automation, listEligible: () => this._getPipelineRuntime().companyStore.listEligible(), enqueuePoll: (input) => pollEnqueue.enqueuePoll(input), stateStore: this.schedulerStateStore, logger: this.logger });
    const taskQueues = ["T02", "T03", "T04", "T05", "T06", "T07", "T08", "T09", "T10", "T12", "T13", "T14"].map((taskId) => `ai-task-${taskId}`);
    this.workerRunner = new QueueWorkerRunner({ queueNames: ["ingest", "pipeline-stage", ...taskQueues], concurrency: Math.max(automation.ingestConcurrency, automation.pipelineConcurrency), recoverStale: () => ingest.jobStore.recoverStale?.({ olderThanMs: automation.workerStaleTimeoutMs }), processNext: (queueName) => {
      if (queueName === "ingest") return ingest.runNext();
      if (queueName === "pipeline-stage") return ingest.queue.processNext({ queueName, workerId: "pipeline-stage-worker", handler: (job) => pipeline.dispatcher.dispatch(job.payload) });
      if (queueName.startsWith("ai-task-")) return pipeline.worker.processNext({ taskId: queueName.replace("ai-task-", "") });
      return null;
    }, logger: this.logger });
    // Automatic intake (scheduler) and queue workers are independent. Manual
    // News intake must still process when Automatic intake desired is off.
    const { startScheduler, startWorkers } = resolveAutomationStart(automation);
    if (startScheduler) this.scheduler.start();
    if (startWorkers) this.workerRunner.start();
  }

  _getPipelineRuntime() {
    if (this.pipelineRuntime) return this.pipelineRuntime;
    const persistence = this._getPersistenceRuntime();
    const queue = this._getIngestRuntime().queue;
    const stateStore = persistence?.pipelineStateStore || new InMemoryPipelineStateStore();
    const companyStore = process.env.AI_PERSISTENCE_MODE === "postgres"
      ? new PostgresPipelineCompanyStore({ db: this.getDatabaseRuntime().ai })
      : { listEligible: () => this.companyStore.listEligible({ effectiveContextStore: this._getCompanyContextRuntime().effectiveContextStore }) };
    const authorize = async ({ tenantId, companyId }) => Boolean(tenantId && companyId);
    const registry = new AiTaskRegistry();
    registry.register("T02", async ({ tenantId, companyId, input }) => { const result = await this._getT02Service().classify({ tenantId, companyId, articleId: input.article_id, locale: input.locale }); return { nextInput: { decision_id: result.decision?.decisionId }, nextTaskId: result.shouldContinue ? "T03" : null, afterNextTaskId: result.shouldContinue ? "T04" : null, result }; });
    registry.register("T03", async ({ tenantId, companyId, input }) => { const result = await this._getT03Service().generate({ tenantId, companyId, decisionId: input.decision_id }); return { nextInput: { decision_id: result.decision?.decisionId }, nextTaskId: "T04", afterNextTaskId: "T05", result }; });
    registry.register("T04", async ({ tenantId, companyId, input }) => { const result = await this._getT04Service().match({ tenantId, companyId, relevanceDecisionId: input.decision_id }); const mutation = await this._getIssueMutationService().apply({ tenantId, companyId, matchDecisionId: result.match.matchDecisionId }); return { nextInput: { issue_id: mutation.mutation?.issueId || mutation.issueId }, nextTaskId: "T05", afterNextTaskId: "T06", result: { match: result, mutation } }; });
    registry.register("T05", async ({ tenantId, companyId, input }) => { const result = await this._getT05Service().generate({ tenantId, companyId, issueId: input.issue_id }); return { nextInput: { issue_id: result.issue?.issueId || input.issue_id }, nextTaskId: "T06", afterNextTaskId: "T07", result }; });
    registry.register("T06", async ({ tenantId, companyId, input }) => { const result = await this._getT06Service().generate({ tenantId, companyId, issueId: input.issue_id }); return { nextInput: { issue_id: result.issue?.issueId || input.issue_id }, nextTaskId: "T07", afterNextTaskId: "T08", result }; });
    registry.register("T07", async ({ tenantId, companyId, input }) => { const result = await this._getT07Service().analyze({ tenantId, companyId, issueId: input.issue_id }); return { nextInput: { issue_id: input.issue_id, analysis_id: result.analysis?.analysisId }, nextTaskId: "T08", afterNextTaskId: "T09", result }; });
    registry.register("T08", async ({ tenantId, companyId, input }) => { const result = await this._getT08Service().label({ tenantId, companyId, analysisId: input.analysis_id }); const promoted = await this._getCitationGate().validateAndPromote({ tenantId, companyId, analysisId: input.analysis_id }); return { nextInput: { issue_id: input.issue_id, analysis_id: input.analysis_id }, nextTaskId: "T09", afterNextTaskId: "T10", result: { labels: result, promoted } }; });
    registry.register("T09", async ({ tenantId, companyId, input }) => { const result = await this._getT09Service().evaluate({ tenantId, companyId, issueId: input.issue_id, analysisId: input.analysis_id }); return { nextInput: { issue_id: input.issue_id, analysis_id: input.analysis_id, priority_decision_id: result.priority?.priorityDecisionId }, nextTaskId: "T10", afterNextTaskId: null, result }; });
    const downstreamBoundary = new AutomationDownstreamBoundary({ alertRuntime: this._getAlertRuntime(), recipientId: process.env.AI_AUTOMATION_RECIPIENT_ID || null, logger: this.logger });
    registry.register("T10", async ({ tenantId, companyId, pipelineId, input }) => { const result = await this._getT10Service().generate({ tenantId, companyId, issueId: input.issue_id, analysisId: input.analysis_id, priorityDecisionId: input.priority_decision_id }); const downstream = await downstreamBoundary.evaluate({ tenantId, companyId, issueId: input.issue_id, pipelineId }); return { result: { priority_reason: result, downstream } }; });
    registry.register("T12", async ({ tenantId, companyId, input }) => ({ result: await this._getT12Service().generate({ tenantId, companyId, alertEventId: input.alert_event_id }) }));
    registry.register("T13", async ({ tenantId, companyId, input }) => ({ result: await this._getReportRuntime().narrativeService.generate({ tenantId, companyId, reportId: input.report_id }) }));
    registry.register("T14", async ({ tenantId, companyId, input }) => ({ result: await this._getReportRuntime().rewriteService.rewrite({ actor: { actorId: "ai-pipeline-worker", actorType: "ai_worker" }, tenantId, companyId, reportId: input.report_id, reportNarrativeId: input.report_narrative_id, allowedSpanId: input.allowed_span_id, humanInstruction: input.instruction, expectedVersion: input.expected_version }) }));
    const worker = new AiPipelineWorker({ queue, registry, stateStore, workerId: "ai-pipeline-worker" });
    const dispatcher = new PipelineStageDispatcher({ companyStore, pipelineStateStore: stateStore, pipelineWorker: worker, logger: this.logger });
    this.pipelineRuntime = { queue, stateStore, companyStore, registry, worker, dispatcher, downstreamBoundary };
    return this.pipelineRuntime;
  }
}

module.exports = Server;
