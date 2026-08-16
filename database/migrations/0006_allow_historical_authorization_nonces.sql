ALTER TABLE reward_authorization_jobs
  DROP INDEX uq_reward_authorization_jobs_nonce,
  ADD COLUMN expired_at TIMESTAMP(6) NULL AFTER consumed_at,
  ADD COLUMN active_nonce_guard TINYINT UNSIGNED
    GENERATED ALWAYS AS (
      CASE
        WHEN status IN ('PLANNED', 'SIGNED', 'READY') THEN 1
        ELSE NULL
      END
    ) STORED,
  ADD UNIQUE KEY uq_reward_authorization_jobs_active_nonce
    (campaign_id, claimant_address, reward_nonce, active_nonce_guard);
