const TASK_MODELS = Object.freeze({ T01: "mini", T02: "nano", T03: "nano", T04: "nano", T05: "nano", T06: "nano", T07: "mini", T08: "nano", T09: "nano", T10: "mini", T12: "nano", T13: "mini", T14: "nano" });
class AiTaskRegistry {
  constructor({ handlers = {} } = {}) { this.handlers = new Map(Object.entries(handlers)); }
  register(taskId, handler) { if (!TASK_MODELS[taskId] || typeof handler !== "function") throw configurationError("Task registration requires a supported task and handler"); this.handlers.set(taskId, handler); return this; }
  get(taskId) { const model = TASK_MODELS[taskId]; const handler = this.handlers.get(taskId); if (!model || !handler) throw configurationError(`AI task worker is not registered: ${taskId}`); return { taskId, model, handler }; }
}
function configurationError(message) { const error = new Error(message); error.code = "AI_TASK_CONFIGURATION_INVALID"; error.statusCode = 503; return error; }
module.exports = { AiTaskRegistry, TASK_MODELS };
