import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import type { Pool, RowDataPacket } from "mysql2/promise";

const MIGRATION_FILE_PATTERN = /^\d{4}_[a-z0-9_]+\.sql$/;

export interface MigrationFile {
  readonly checksum: string;
  readonly filename: string;
  readonly sql: string;
}

interface AppliedMigrationRow extends RowDataPacket {
  readonly checksum: string;
  readonly filename: string;
}

export async function discoverMigrations(
  directory: string,
): Promise<readonly MigrationFile[]> {
  const filenames = (await readdir(directory))
    .filter((filename) => filename.endsWith(".sql"))
    .sort();

  for (const filename of filenames) {
    if (!MIGRATION_FILE_PATTERN.test(filename)) {
      throw new Error(`Invalid migration filename: ${filename}`);
    }
  }

  return Promise.all(
    filenames.map(async (filename) => {
      const sql = await readFile(resolve(directory, filename), "utf8");
      return {
        checksum: createHash("sha256").update(sql).digest("hex"),
        filename,
        sql,
      };
    }),
  );
}

export async function runMigrations(
  pool: Pool,
  directory: string,
): Promise<{ readonly applied: readonly string[]; readonly pending: number }> {
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename VARCHAR(255) PRIMARY KEY,
      checksum CHAR(64) NOT NULL,
      applied_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  const migrations = await discoverMigrations(directory);
  const [rows] = await pool.query<AppliedMigrationRow[]>(
    "SELECT filename, checksum FROM schema_migrations ORDER BY filename",
  );
  const appliedByName = new Map(rows.map((row) => [row.filename, row.checksum]));
  const applied: string[] = [];

  for (const migration of migrations) {
    const existingChecksum = appliedByName.get(migration.filename);
    if (existingChecksum && existingChecksum !== migration.checksum) {
      throw new Error(`Applied migration checksum mismatch: ${migration.filename}`);
    }
    if (existingChecksum) {
      continue;
    }

    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      await connection.query(migration.sql);
      await connection.execute(
        "INSERT INTO schema_migrations (filename, checksum) VALUES (?, ?)",
        [migration.filename, migration.checksum],
      );
      await connection.commit();
      applied.push(migration.filename);
    } catch (error: unknown) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  return { applied, pending: 0 };
}
