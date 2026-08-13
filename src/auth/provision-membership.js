async function provisionThenInvite(localAuthService, membershipStore, { email, password, fullName, userId, tenantId, companyId = null, role }) {
  const provisioned = await localAuthService.provision({ email, password, fullName });
  return membershipStore.invite({
    userId: userId || provisioned.userId,
    email: provisioned.email,
    fullName: provisioned.fullName,
    tenantId,
    companyId,
    role,
    status: "active",
  });
}

function serializeMembership(item) {
  return {
    membership_id: item.membershipId,
    user_id: item.userId,
    tenant_id: item.tenantId,
    company_id: item.companyId,
    role: item.role,
    status: item.status,
    version: item.version,
    permissions: item.permissions || [],
    email: item.email || null,
    full_name: item.fullName ?? item.full_name ?? null,
  };
}

module.exports = { provisionThenInvite, serializeMembership };
