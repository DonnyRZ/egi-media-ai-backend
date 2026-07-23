const express = require("express");
const cookieParser = require("cookie-parser");
const swaggerUi = require("swagger-ui-express");
const path = require("path");

const config = require("../config/global_config");
const corsMiddleware = require("./cors");
const registerRoutes = require("../routes");
const { createCompanyContextRuntime } = require("../company-context/runtime");

class Server {
  constructor() {
    this.app = express();
    this.port = config.get("/port");
    this.companyContextRuntime = createCompanyContextRuntime();

    this._middlewares();
    this._routes();
  }

  _middlewares() {
    this.app.use(corsMiddleware);
    this.app.use(express.json({ limit: "1mb" }));
    this.app.use(cookieParser());
  }

  _routes() {
    this.app.get("/", (_req, res) => {
      res.json({ success: true, service: "egi-media-ai-backend", status: "workspace-ready" });
    });

    const swaggerFile = require(path.join(__dirname, "../../swagger_output.json"));
    this.app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerFile, {
      explorer: true,
      customSiteTitle: "EGI Media AI Backend API Docs",
    }));

    registerRoutes(this.app, { companyContextService: this.companyContextRuntime.service });
  }

  listen() {
    this.app.listen(this.port, () => {
      console.log(`EGI Media AI backend listening on port ${this.port}`);
      console.log(`Swagger UI: http://localhost:${this.port}/api-docs`);
    });
  }
}

module.exports = Server;
