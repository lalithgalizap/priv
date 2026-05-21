# ADR 0002 — Per-user at-rest encryption

Status: Accepted, in production.

## Context

Chat history (prompts, model output) and personal system prompts are
sensitive. A database dump must not be enough to read users' content.

## Decision

`chat_messages.content` and `user_profiles.system_prompt` are encrypted
with AES-256-GCM using a key derived per user:

```
user_key = HMAC-SHA256(master = ENCRYPTION_KEY, user_id)
```

Storage format: `enc:` + base64(nonce[12] || ciphertext || tag[16]).

The master `ENCRYPTION_KEY` lives only in EC2 environment (eventually AWS
Secrets Manager). The DB never sees it.

In production, the module fails closed: if `ENCRYPTION_KEY` is missing
or malformed, the application refuses to start. Decryption failures
raise `DecryptionError`; the public `safe_decrypt` returns a placeholder
so a single bad row does not break a list response.

## Consequences

- A DB dump alone is useless: no keys.
- The master key alone is useless: derivation needs each user's id.
- One user's compromised derived key leaks only that user's data.
- Key rotation is non-trivial: re-encrypting every row in place needs a
  background migration that reads with the old key and writes with the
  new key. Documented as a TODO in `runbook.md`.

## Considered alternatives

- **Postgres TDE / disk-level encryption.** Rejected: protects against
  stolen disks, not against an attacker who pops a database admin
  account.
- **Single application-wide key for all users.** Rejected: a derived-key
  scheme caps blast radius to a single user.
- **AWS KMS for every encrypt/decrypt.** Rejected for now: latency cost
  too high for the chat hot path. Can be revisited as an envelope wrapper
  around the master key.
