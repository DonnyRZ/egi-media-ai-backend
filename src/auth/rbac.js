const ROLES = Object.freeze(["platform_superadmin", "tenant_owner", "tenant_admin", "company_admin", "executive", "executive_viewer", "analyst", "reviewer", "viewer", "ai_worker"]);
const PERMISSIONS = Object.freeze([
  "dashboard.read", "issue.read", "issue.complete", "issue.save", "company_context.read", "company_context.draft", "company_context.review", "company_context.approve",
  "report.read", "report.create", "report.review.submit", "report.approve", "report.share", "report.rewrite", "alert.read", "alert.preference.manage", "feedback.create",
  "tenant.users.manage", "tenant.companies.manage", "tenant.settings.manage", "company.users.manage", "audit.read", "platform.tenants.manage", "platform.audit.read", "ai.pipeline.run", "report.narrative.generate",
]);
const ROLE_PERMISSIONS = Object.freeze({
  platform_superadmin: new Set(PERMISSIONS),
  tenant_owner: new Set(PERMISSIONS.filter((p) => !p.startsWith("platform." ) && p !== "ai.pipeline.run")),
  tenant_admin: new Set(PERMISSIONS.filter((p) => !p.startsWith("platform." ) && p !== "ai.pipeline.run")),
  company_admin: new Set(["dashboard.read", "issue.read", "issue.complete", "issue.save", "company_context.read", "company_context.draft", "company_context.review", "company_context.approve", "report.read", "report.create", "report.review.submit", "report.approve", "report.share", "report.rewrite", "alert.read", "alert.preference.manage", "feedback.create", "company.users.manage"]),
  executive: new Set(["dashboard.read", "issue.read", "issue.save", "company_context.read", "report.read", "report.approve", "report.share", "alert.read", "alert.preference.manage", "feedback.create"]),
  executive_viewer: new Set(["dashboard.read", "issue.read", "issue.save", "company_context.read", "report.read", "alert.read", "feedback.create"]),
  analyst: new Set(["dashboard.read", "issue.read", "issue.complete", "issue.save", "company_context.read", "company_context.draft", "company_context.review", "report.read", "report.create", "report.review.submit", "report.rewrite", "alert.read", "alert.preference.manage", "feedback.create"]),
  reviewer: new Set(["dashboard.read", "issue.read", "company_context.read", "report.read", "report.review.submit", "report.approve", "report.share", "alert.read", "feedback.create"]),
  viewer: new Set(["dashboard.read", "issue.read", "issue.save", "company_context.read", "report.read", "alert.read", "feedback.create"]),
  ai_worker: new Set(["ai.pipeline.run", "report.narrative.generate"]),
});
function isRole(value) { return ROLES.includes(value); }
function permissionsForRole(role) { return new Set(ROLE_PERMISSIONS[role] || []); }
function hasPermission(role, permission) { return permissionsForRole(role).has(permission); }
module.exports = { ROLES, PERMISSIONS, ROLE_PERMISSIONS, isRole, permissionsForRole, hasPermission };
