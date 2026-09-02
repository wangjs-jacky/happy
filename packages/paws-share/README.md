# Paws Share

Publish complete Codex and Claude Code conversations as read-only Paws snapshots without a Paws account.

```bash
npx --yes @wangjs-jacky/paws-share@latest inspect --current --json
npx --yes @wangjs-jacky/paws-share@latest share --current --yes --json
```

The CLI uploads only a validated snapshot and resolved structured attachments. It stores a per-link management capability in `${PAWS_SHARE_HOME:-~/.paws-share}/shares.json` with owner-only permissions; the public URL and command output never contain that capability.

Manage links locally:

```bash
npx --yes @wangjs-jacky/paws-share@latest list --json
npx --yes @wangjs-jacky/paws-share@latest status <public-id> --json
npx --yes @wangjs-jacky/paws-share@latest renew <public-id> --json
npx --yes @wangjs-jacky/paws-share@latest replace <public-id> --current --yes --json
npx --yes @wangjs-jacky/paws-share@latest revoke <public-id> --json
```

Use `--source codex|claude-code --session /path/to/session.jsonl` when current-directory discovery is ambiguous. Public snapshots expire after 90 days unless renewed.

## Install the Agent Skill

Install the bundled `share-session` skill for Codex, Claude Code, or both:

```bash
npx --yes @wangjs-jacky/paws-share@latest install-skill --target all --json
```

Start a new agent session so it discovers the skill, then ask naturally, for example:

```text
Use $share-session to share this conversation as a public read-only link.
```

The skill inspects the exact transcript before publication, includes resolved structured attachments, blocks unresolved attachments and high-confidence secrets by default, and keeps the management capability local.
