CREATE TABLE reward_user_wallets (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  wallet_address CHAR(42) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  encrypted_private_key VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  encryption_iv VARCHAR(24) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  encryption_auth_tag VARCHAR(24) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  encryption_key_version INT UNSIGNED NOT NULL,
  status ENUM('ACTIVE', 'DISABLED') NOT NULL DEFAULT 'ACTIVE',
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY uq_reward_user_wallets_wallet_address (wallet_address),
  KEY idx_reward_user_wallets_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
