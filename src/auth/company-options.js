/**
 * Normalize and enrich authorized-company option lists with display names
 * from the company store. Missing companies stay name: null (no throw).
 */

function normalizeCompanyOption(item, fallbackTenantId = null) {
  if (item == null) return null;
  if (typeof item === "string") {
    return {
      company_id: item,
      ...(fallbackTenantId ? { tenant_id: fallbackTenantId } : {}),
      name: null,
    };
  }
  const companyId = item.company_id || item.companyId || item.id;
  if (!companyId) return null;
  const tenantId = item.tenant_id || item.tenantId || fallbackTenantId || null;
  return {
    company_id: companyId,
    ...(tenantId ? { tenant_id: tenantId } : {}),
    name: typeof item.name === "string" && item.name.trim() ? item.name.trim() : null,
    ...(item.role ? { role: item.role } : {}),
  };
}

/**
 * @param {Array<object|string|null|undefined>} items
 * @param {{ getCompanyStore?: () => { get?: Function, list?: Function }, fallbackTenantId?: string|null }} options
 */
async function enrichCompanyOptions(items, { getCompanyStore, fallbackTenantId = null } = {}) {
  const list = Array.isArray(items) ? items : [];
  const normalized = list.map((item) => normalizeCompanyOption(item, fallbackTenantId)).filter(Boolean);
  if (!normalized.length) return [];

  const store = typeof getCompanyStore === "function" ? getCompanyStore() : null;
  const nameByKey = new Map();

  if (store?.list) {
    const tenantIds = [...new Set(normalized.map((item) => item.tenant_id).filter(Boolean))];
    await Promise.all(
      tenantIds.map(async (tenantId) => {
        try {
          const page = await store.list({ tenantId, page: 1, limit: 200 });
          for (const company of page?.items || []) {
            if (!company?.companyId) continue;
            nameByKey.set(`${company.tenantId}:${company.companyId}`, company.name || null);
          }
        } catch {
          // Fall through to per-item get below.
        }
      }),
    );
  }

  if (store?.get) {
    await Promise.all(
      normalized.map(async (item) => {
        if (!item.tenant_id) return;
        const key = `${item.tenant_id}:${item.company_id}`;
        if (nameByKey.has(key)) return;
        try {
          const company = await store.get({ tenantId: item.tenant_id, companyId: item.company_id });
          nameByKey.set(key, company?.name || null);
        } catch {
          nameByKey.set(key, null);
        }
      }),
    );
  }

  return normalized.map((item) => {
    const key = item.tenant_id ? `${item.tenant_id}:${item.company_id}` : null;
    const fromStore = key ? nameByKey.get(key) : undefined;
    const name =
      (typeof fromStore === "string" && fromStore.trim() ? fromStore.trim() : null) ||
      item.name ||
      null;
    return {
      company_id: item.company_id,
      ...(item.tenant_id ? { tenant_id: item.tenant_id } : {}),
      name,
      ...(item.role ? { role: item.role } : {}),
    };
  });
}

module.exports = { normalizeCompanyOption, enrichCompanyOptions };
