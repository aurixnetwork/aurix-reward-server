import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
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
});
