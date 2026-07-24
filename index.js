process.on("uncaughtException", (error) => {
  console.error("Uncaught Exception:", error);
  process.exit(1);
});

process.on("unhandledRejection", (reason) => {
  console.error("Unhandled Rejection:", reason);
  process.exit(1);
});

const Server = require("./src/app/server");

const server = new Server();
server.start().catch((error) => {
  console.error("Server startup failed:", error.message);
  process.exit(1);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, async () => {
    try {
      await server.stop();
      process.exit(0);
    } catch (error) {
      console.error("Graceful shutdown failed:", error);
      process.exit(1);
    }
  });
}
