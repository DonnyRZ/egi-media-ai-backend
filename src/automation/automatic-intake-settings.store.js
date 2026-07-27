"use strict";

const fs = require("fs");
const path = require("path");

const SETTINGS_KEY = "automatic_intake";

/**
 * Process-global Automatic intake desired state.
 * Phase 1: one boolean for the whole process (not per-tenant).
 */
class InMemoryAutomaticIntakeSettingsStore {
  constructor({ initial = null } = {}) {
    this.record = normalizeRecord(initial);
  }

  async get() {
    return this.record ? structuredClone(this.record) : null;
  }

  async setDesired(desired, { source = "manage_api", now = Date.now } = {}) {
    this.record = {
      desired: Boolean(desired),
      updatedAt: new Date(typeof now === "function" ? now() : now).toISOString(),
      source: String(source || "manage_api"),
    };
    return structuredClone(this.record);
  }
}

/**
 * Host-local durable store (survives process restart).
 * Not shared across replicas unless they share the same file path/volume.
 */
class FileAutomaticIntakeSettingsStore {
  constructor({ filePath, fsModule = fs, now = Date.now } = {}) {
    if (!filePath) throw new TypeError("FileAutomaticIntakeSettingsStore requires filePath");
    this.filePath = filePath;
    this.fs = fsModule;
    this.now = now;
  }

  async get() {
    try {
      const raw = this.fs.readFileSync(this.filePath, "utf8");
      const parsed = JSON.parse(raw);
      return normalizeRecord(parsed?.[SETTINGS_KEY] || parsed);
    } catch (error) {
      if (error && (error.code === "ENOENT" || error.code === "ENOTDIR")) return null;
      throw error;
    }
  }

  async setDesired(desired, { source = "manage_api" } = {}) {
    const record = {
      desired: Boolean(desired),
      updatedAt: new Date(this.now()).toISOString(),
      source: String(source || "manage_api"),
    };
    const dir = path.dirname(this.filePath);
    this.fs.mkdirSync(dir, { recursive: true });
    const payload = `${JSON.stringify({ [SETTINGS_KEY]: record }, null, 2)}\n`;
    const tmp = `${this.filePath}.${process.pid}.tmp`;
    this.fs.writeFileSync(tmp, payload, "utf8");
    this.fs.renameSync(tmp, this.filePath);
    return structuredClone(record);
  }
}

/**
 * Shared durable store for postgres persistence mode.
 */
class PostgresAutomaticIntakeSettingsStore {
  constructor({ db, now = Date.now } = {}) {
    if (!db || typeof db.query !== "function") throw new TypeError("PostgresAutomaticIntakeSettingsStore requires db.query");
    this.db = db;
    this.now = now;
  }

  async get() {
    const result = await this.db.query(
      "SELECT value_jsonb FROM ai.process_settings WHERE key = $1",
      [SETTINGS_KEY],
    );
    const row = result.rows?.[0];
    return normalizeRecord(row?.value_jsonb || null);
  }

  async setDesired(desired, { source = "manage_api" } = {}) {
    const record = {
      desired: Boolean(desired),
      updatedAt: new Date(this.now()).toISOString(),
      source: String(source || "manage_api"),
    };
    await this.db.query(
      `INSERT INTO ai.process_settings (key, value_jsonb, updated_at)
       VALUES ($1, $2::jsonb, $3::timestamptz)
       ON CONFLICT (key) DO UPDATE SET value_jsonb = EXCLUDED.value_jsonb, updated_at = EXCLUDED.updated_at`,
      [SETTINGS_KEY, JSON.stringify(record), record.updatedAt],
    );
    return structuredClone(record);
  }
}

function normalizeRecord(input) {
  if (!input || typeof input !== "object") return null;
  if (typeof input.desired !== "boolean") return null;
  return {
    desired: input.desired,
    updatedAt: typeof input.updatedAt === "string" ? input.updatedAt : null,
    source: typeof input.source === "string" ? input.source : null,
  };
}

function defaultAutomaticIntakeSettingsPath(env = process.env) {
  if (typeof env.AI_AUTOMATIC_INTAKE_SETTINGS_PATH === "string" && env.AI_AUTOMATIC_INTAKE_SETTINGS_PATH.trim()) {
    return env.AI_AUTOMATIC_INTAKE_SETTINGS_PATH.trim();
  }
  return path.join(process.cwd(), ".data", "automatic-intake-settings.json");
}

module.exports = {
  SETTINGS_KEY,
  InMemoryAutomaticIntakeSettingsStore,
  FileAutomaticIntakeSettingsStore,
  PostgresAutomaticIntakeSettingsStore,
  defaultAutomaticIntakeSettingsPath,
  normalizeRecord,
};
