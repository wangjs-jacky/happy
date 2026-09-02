---
name: share-session
description: Publish local Codex or Claude Code conversations as complete, read-only Paws snapshots, including structured attachments. Use when a user asks to inspect or share a coding-agent session, create a public conversation link, or list, check, replace, renew, or revoke a link managed by Paws Share.
---

# Share Session

Use `npx --yes @wangjs-jacky/paws-share@latest` as the transcript parser, uploader, and capability manager. This works without a global install. Do not parse provider JSONL, read the local share-management store, handle management tokens, or upload attachments yourself.

## Select the transcript

Prefer the most specific identity available:

1. If the user supplied a provider and JSONL path, use them exactly.
2. In Codex, when `CODEX_THREAD_ID` is set, use `rg --files "${CODEX_HOME:-$HOME/.codex}/sessions"` to resolve the single JSONL filename containing that exact thread ID. Then use `--source codex --session "$session_path"`. Do not read the transcript to identify it.
3. Otherwise use `--current`. If it reports no match or multiple matches, stop and ask the user to choose an explicit session. Never select the newest or an unrelated session as a guess.

Use the same selector for inspection and publication.

## Create a public link

1. Inspect before uploading. For an exact Codex transcript, run:

   ```bash
   npx --yes @wangjs-jacky/paws-share@latest inspect --source codex --session "$session_path" --json
   ```

   When using directory discovery, replace the selector with `--current`.

2. Report the provider, title, message count, attachment count and bytes, unresolved attachment count, blocking finding count, warning finding count, and 90-day expiry. State that the result is a public, read-only snapshot available to anyone with the link and that resolved structured attachments are included.
3. Do not publish if `unresolvedAttachmentCount` or `blockingFindingCount` is nonzero. Resolve transcript ambiguity with an explicit provider and path; never guess.
4. An explicit request to share, publish, or create the public link authorizes publication after a clean inspection. A request only to inspect, explain, or preview does not. Publish with the identical selector:

   ```bash
   npx --yes @wangjs-jacky/paws-share@latest share --source codex --session "$session_path" --yes --json
   ```

5. Return `publicUrl`, `expiresAt`, and a short confirmation that it is a read-only snapshot. Never return the local transcript path, management record path, or any management capability.

Never add `--allow-sensitive` merely to complete the task. Use it only after reporting the blocking findings and receiving a separate, explicit instruction to publish despite them. Do not claim success unless the command returns `publicUrl`.

## Other providers

For Claude Code, use the same inspect-then-share workflow with `--source claude-code` and its explicit JSONL path:

```bash
npx --yes @wangjs-jacky/paws-share@latest inspect --source claude-code --session /path/to/session.jsonl --json
npx --yes @wangjs-jacky/paws-share@latest share --source claude-code --session /path/to/session.jsonl --yes --json
```

## Manage links

Run management commands on the same machine that created the link so the local capability remains private:

```bash
npx --yes @wangjs-jacky/paws-share@latest list --json
npx --yes @wangjs-jacky/paws-share@latest status <public-id> --json
npx --yes @wangjs-jacky/paws-share@latest renew <public-id> --json
npx --yes @wangjs-jacky/paws-share@latest replace <public-id> --current --yes --json
npx --yes @wangjs-jacky/paws-share@latest revoke <public-id> --json
```

Inspect the replacement transcript first and use the same exact selector for `replace`. Replacing preserves the public URL. Revocation is terminal for that link. Losing the local management record is intentionally unrecoverable without an account.

If a command fails, report the error and do not invent or infer a public URL. Do not retry a mutating command automatically when its outcome is unknown. Use `list` and `status` to establish the recorded state first. Use a custom `--server` only when the user explicitly supplies a trusted Paws Share server.
