import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const migrationUrl = new URL(
  "../database/migrations/0006_allow_historical_authorization_nonces.sql",
  import.meta.url,
);

describe("authorization active nonce migration", () => {
  it("replaces the unconditional nonce index with a STORED generated guard", async () => {
    const sql = await readFile(migrationUrl, "utf8");
    expect(sql).toContain("DROP INDEX uq_reward_authorization_jobs_nonce");
    expect(sql).toMatch(/active_nonce_guard[\s\S]*GENERATED ALWAYS AS[\s\S]*STORED/i);
  });

  it("guards exactly PLANNED, SIGNED, and READY as active", async () => {
    const sql = await readFile(migrationUrl, "utf8");
    expect(sql).toContain("status IN ('PLANNED', 'SIGNED', 'READY')");
    expect(sql).toContain("ELSE NULL");
  });

  it("creates the active-only tuple unique index", async () => {
    const sql = await readFile(migrationUrl, "utf8");
    expect(sql).toMatch(
      /UNIQUE KEY uq_reward_authorization_jobs_active_nonce\s*\(campaign_id, claimant_address, reward_nonce, active_nonce_guard\)/,
    );
  });

  it("allows multiple EXPIRED historical rows through NULL guard semantics", () => {
    expect(activeNonceGuard("EXPIRED")).toBeNull();
    expect(activeNonceGuard("EXPIRED")).toBeNull();
  });

  it("allows CONSUMED history while a later row is active", () => {
    expect(activeNonceGuard("CONSUMED")).toBeNull();
    expect(activeNonceGuard("READY")).toBe(1);
  });
});

function activeNonceGuard(status: string): 1 | null {
  return ["PLANNED", "SIGNED", "READY"].includes(status) ? 1 : null;
}
