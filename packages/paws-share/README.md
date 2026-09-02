# Paws Share

Publish complete Codex and Claude Code conversations as read-only Paws snapshots without a Paws account.

```bash
npx --yes @wangjs-jacky/paws-share@beta inspect --current --json
npx --yes @wangjs-jacky/paws-share@beta share --current --yes --json
```

The CLI uploads only a validated snapshot and resolved structured attachments. It stores a per-link management capability in `${PAWS_SHARE_HOME:-~/.paws-share}/shares.json` with owner-only permissions; the public URL and command output never contain that capability.

## Local offline HTML

Create one self-contained HTML file without uploading anything:

```bash
npx --yes @wangjs-jacky/paws-share@beta export-html --current --output ./paws-session.html --json
```

The HTML uses the same standardized snapshot preparation as public sharing. CSS, interaction code, images, audio, video, and downloadable file attachments are embedded in the output, so it opens offline. Existing files are preserved unless `--force` is explicit. High-confidence secrets and unresolved attachments remain blocked by default.

The implementation keeps provider parsing and safety policy behind one shared snapshot-preparation module:

```text
Codex / Claude Code adapters -> prepared Paws snapshot -> remote publisher
                                                     `-> local HTML exporter
```

The local exporter has no server client or management-record dependency. Provider-specific host envelopes are removed before either output receives the snapshot, so fixes apply to both paths.

Manage links locally:

```bash
npx --yes @wangjs-jacky/paws-share@beta list --json
npx --yes @wangjs-jacky/paws-share@beta status <public-id> --json
npx --yes @wangjs-jacky/paws-share@beta renew <public-id> --json
npx --yes @wangjs-jacky/paws-share@beta replace <public-id> --current --yes --json
npx --yes @wangjs-jacky/paws-share@beta revoke <public-id> --json
```

Use `--source codex|claude-code --session /path/to/session.jsonl` when current-directory discovery is ambiguous. Public snapshots expire after 90 days unless renewed.

## Install the Agent Skill

Install the bundled `share-session` skill for Codex, Claude Code, or both:

```bash
npx --yes @wangjs-jacky/paws-share@beta install-skill --target all --json
```

Start a new agent session so it discovers the skill, then ask naturally, for example:

```text
Use $share-session to share this conversation as a public read-only link.
```

The skill chooses local HTML or public publication from the user's request, inspects the exact transcript, includes resolved structured attachments, blocks unresolved attachments and high-confidence secrets by default, and keeps public-link management capabilities local.
