# Test User Wallet security

## Scope and separation

Phase 2 manages BSC Testnet User Wallets so later phases can make each User
Wallet the sender, gas payer, and reward recipient for its own claim. These are
not Admin/Deployer, Approver, Operations, or Funding wallets. Their records and
encryption key are logically separate from every other role.

Phase 2 creates no campaign, sends no tBNB, executes no reward claim, and sends
no blockchain transaction.

## Encryption format

Private keys are encrypted before persistence with Node.js `crypto` using
AES-256-GCM:

- key: exactly 32 random bytes, supplied as canonical padded Base64 through
  `WALLET_ENCRYPTION_KEY`;
- IV: 12 cryptographically random bytes generated independently for every
  encryption;
- authentication tag: 16 bytes;
- additional authenticated data: the checksummed wallet address converted to
  lowercase, a colon, and the decimal encryption-key version;
- persisted encoding: canonical Base64 for ciphertext, IV, and authentication
  tag.

The database stores the encryption key version with each record. On decryption,
GCM authenticates the ciphertext, IV-dependent computation, tag, address, and
version. The application then creates an ethers Wallet from the recovered key
and independently compares its derived address with the stored address.

No mnemonic is returned by the generator module, stored, logged, or documented.
The application does not claim that JavaScript can guarantee secure memory
zeroization.

## Key custody and recovery

`WALLET_ENCRYPTION_KEY` is a high-value secret. Keep a tested backup in an
approved secret manager, restrict access, and back up its version metadata. Do
not put it in Git, documentation, command history, logs, tickets, or chat.

If `WALLET_ENCRYPTION_KEY` is lost, the encrypted User Wallet private keys may be
permanently unrecoverable. Database backups alone are insufficient. If the key
is disclosed, treat every wallet encrypted by that key version as compromised.

Changing `WALLET_ENCRYPTION_KEY_VERSION` without implementing and executing a
reviewed key-rotation migration does not re-encrypt existing records. The Phase
2 validator deliberately fails records whose stored version differs from the
configured version.
