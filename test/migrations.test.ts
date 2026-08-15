import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { discoverMigrations } from "../src/database/migrations.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { force: true, recursive: true }),
    ),
  );
});

async function createTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "aurix-migrations-"));
  temporaryDirectories.push(directory);
  return directory;
}

describe("migration discovery", () => {
  it("sorts migrations and calculates deterministic checksums", async () => {
    const directory = await createTemporaryDirectory();
    await writeFile(join(directory, "0002_second.sql"), "SELECT 2;\n");
    await writeFile(join(directory, "0001_first.sql"), "SELECT 1;\n");

    const migrations = await discoverMigrations(directory);

    expect(migrations.map((migration) => migration.filename)).toEqual([
      "0001_first.sql",
      "0002_second.sql",
    ]);
    expect(migrations[0]?.checksum).toBe(
      createHash("sha256").update("SELECT 1;\n").digest("hex"),
    );
  });

  it("rejects unversioned SQL files", async () => {
    const directory = await createTemporaryDirectory();
    await writeFile(join(directory, "initial.sql"), "SELECT 1;\n");

    await expect(discoverMigrations(directory)).rejects.toThrow(
      "Invalid migration filename",
    );
  });

  it("defines the encrypted wallet schema without plaintext secret columns", async () => {
    const migration = await readFile(
      new URL(
        "../database/migrations/0001_create_reward_user_wallets.sql",
        import.meta.url,
      ),
      "utf8",
    );

    expect(migration).toContain("CREATE TABLE reward_user_wallets");
    expect(migration).toContain("UNIQUE KEY uq_reward_user_wallets_wallet_address");
    expect(migration).toContain("encrypted_private_key");
    expect(migration).toContain("encryption_auth_tag");
    expect(migration).not.toMatch(/\bprivate_key\b/);
    expect(migration).not.toMatch(/\bmnemonic\b/);
  });

  it("defines the funding lifecycle schema with exact numeric storage", async () => {
    const migration = await readFile(
      new URL(
        "../database/migrations/0002_create_reward_wallet_funding_jobs.sql",
        import.meta.url,
      ),
      "utf8",
    );
    expect(migration).toContain("CREATE TABLE reward_wallet_funding_jobs");
    expect(migration).toContain("VARCHAR(78)");
    expect(migration).toContain("uq_reward_wallet_funding_jobs_job_id");
    expect(migration).toContain("uq_reward_wallet_funding_jobs_active_wallet");
    expect(migration).not.toContain("raw_transaction");
    expect(migration).not.toContain("private_key");
  });

  it("defines authorization replay constraints without private-key storage", async () => {
    const migration = await readFile(
      new URL(
        "../database/migrations/0003_create_reward_authorization_jobs.sql",
        import.meta.url,
      ),
      "utf8",
    );
    expect(migration).toContain("CREATE TABLE reward_authorization_jobs");
    expect(migration).toContain("uq_reward_authorization_jobs_reward_id");
    expect(migration).toContain("uq_reward_authorization_jobs_nonce");
    expect(migration).toContain("approver_signature");
    expect(migration).not.toMatch(/approver_private_key|user_private_key|mnemonic/);
  });

  it("defines campaign execution evidence without raw transactions or keys", async () => {
    const migration = await readFile(
      new URL(
        "../database/migrations/0004_create_campaign_execution_operations.sql",
        import.meta.url,
      ),
      "utf8",
    );
    expect(migration).toContain("CREATE TABLE campaign_execution_operations");
    expect(migration).toContain("signed_tx_hash");
    expect(migration).toContain("uq_campaign_execution_operations_active_type");
    expect(migration).not.toMatch(/raw_transaction|private_key|mnemonic/);
  });
});
