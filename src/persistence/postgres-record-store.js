const { randomUUID } = require("crypto");

class PostgresRecordStore {
  constructor({ db, table, mapRow = (row) => row.payload_jsonb, uuid = randomUUID } = {}) {
    if (!db?.query || !table) throw new TypeError("PostgresRecordStore requires a database adapter and table");
    this.db = db; this.table = table; this.mapRow = mapRow; this.uuid = uuid;
  }
  async findOne({ id, tenantId, companyId } = {}) {
    const predicates = ["id = $1"]; const values = [id];
    if (tenantId !== undefined) { values.push(tenantId); predicates.push(`tenant_id = $${values.length}`); }
    if (companyId !== undefined) { values.push(companyId); predicates.push(`company_id = $${values.length}`); }
    const result = await this.db.query(`SELECT * FROM ${this.table} WHERE ${predicates.join(" AND ")} LIMIT 1`, values);
    return result.rows[0] ? this.mapRow(result.rows[0]) : null;
  }
  async list({ tenantId, companyId, issueId, orderBy = "created_at ASC" } = {}) {
    const predicates = ["TRUE"]; const values = [];
    for (const [column, value] of [["tenant_id", tenantId], ["company_id", companyId], ["issue_id", issueId]]) {
      if (value !== undefined) { values.push(value); predicates.push(`${column} = $${values.length}`); }
    }
    const result = await this.db.query(`SELECT * FROM ${this.table} WHERE ${predicates.join(" AND ")} ORDER BY ${orderBy}`, values);
    return result.rows.map(this.mapRow);
  }
}
module.exports = { PostgresRecordStore };
