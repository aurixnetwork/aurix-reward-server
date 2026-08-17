ALTER TABLE reward_user_wallets
  ADD COLUMN network_profile ENUM('TESTNET','MAINNET') NOT NULL DEFAULT 'TESTNET' AFTER wallet_address,
  ADD KEY idx_reward_user_wallets_network_status (network_profile, status);
