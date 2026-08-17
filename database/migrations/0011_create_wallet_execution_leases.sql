CREATE TABLE wallet_execution_leases (
  chain_id INT UNSIGNED NOT NULL,
  wallet_address CHAR(42) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  owner_id VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  lease_token CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  acquired_at TIMESTAMP(6) NOT NULL,
  expires_at TIMESTAMP(6) NOT NULL,
  updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (chain_id, wallet_address),
  UNIQUE KEY uq_wallet_execution_leases_token (lease_token),
  KEY idx_wallet_execution_leases_expiry (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
