# Session history reconciliation

`GET /v3/sessions/changes` requires the existing bearer authentication. It never
returns message bodies, metadata ciphertext, agent-state ciphertext or attachment
URLs. It complements the existing session snapshot and message routes.

Query: optional opaque `cursor`, optional integer `limit` (default 200, range
1–500). Omit the cursor for initial reconciliation or after a reset response.

```json
{
  "changes": [
    {
      "sessionId": "session-id",
      "revision": "123",
      "deleted": false,
      "lastMessageSeq": 87,
      "metadataVersion": 2,
      "agentStateVersion": 4
    }
  ],
  "nextCursor": "opaque-value",
  "hasMore": false
}
```

`revision` is a decimal string, ordered within the authenticated account. Treat
`nextCursor` as opaque and scope it to the server origin and account. Persist it
only after the page's associated local writes succeed. Replaying a page is safe;
apply only newer revisions for each session, including deletion tombstones.

`lastMessageSeq` is the highest committed message sequence, not `Session.seq`:
reserved sequences and metadata updates must not cause history downloads. Sparse
sequences are valid. Metadata and state versions indicate when the separate
snapshot needs refreshing. For an unchanged message frontier, cached confirmed
pages remain valid. This protocol assumes append-only message bodies and whole
session deletion; it does not support arbitrary message-body edits or individual
message deletion.

Each session occupies one durable latest-change row. Deleted sessions retain
`deleted: true` tombstones indefinitely. Changed rows can move forward between
pages and may appear again; keyset pagination never moves them behind the cursor.
The cursor advances only to the last returned revision, never an unread head.
`hasMore: false` completes the current sweep; later commits appear on the next
request. There is no retained-log limit, cursor expiration or overflow reset.
BIGINT exhaustion fails the mutation atomically rather than wrapping revisions.

An initial sweep includes all current session identities, including sessions that
predate deployment, plus retained tombstones. It is not a frozen list snapshot.
**Absence from any page or sweep is not deletion evidence.** Remove local data
only for an explicit tombstone or another authoritative deletion response. Data
cached before the protocol existed may refer to sessions deleted before its
installation; verify those identities individually via the authenticated session
lookup (404), as no historical tombstone can be reconstructed for them.

Malformed, account-mismatched or ahead-of-head cursors receive HTTP 409:
`{"error":"reset-required"}`. Restart without a cursor, preserving cached history.
Invalid limits / oversized query values receive HTTP 400. Server/storage failures
remain server errors. A missing endpoint on an older server is a capability miss;
clients should keep their existing compatible sync behavior.

## Installation and mutation coverage

Apply `20260907000000_session_changes` before starting the new server endpoint.
The migration runs in one transaction, locks Session and SessionMessage against
writes, backfills existing sessions with their actual maximum message sequence,
and installs database triggers before releasing those locks. This needs a brief
write-maintenance window proportional to existing session/message count. Both
PostgreSQL and the supported standalone PGlite runner execute the same SQL.

Database triggers cover Session INSERT/DELETE and metadata/state-version updates,
plus every SessionMessage INSERT (including REST batches, socket writes and older
server writers). Counter allocation and the changed row share the mutation's
transaction. A separate per-account counter row stays locked until commit, so a
reader cannot advance past an earlier uncommitted revision. A PostgreSQL sequence
alone would not provide this property. Heartbeats and Session.seq allocation do
not produce changes.

The current socket writer allocates its session sequence and writes the body in
one transaction, using the same session row lock as REST batches. Deploy updated
writers together: old socket binaries allocate sequences outside the insert
transaction and may commit a lower sequence after a higher one. Although triggers
still report such writes, an `after_seq` client can miss that late lower sequence.
Drain old socket writers before enabling clients to rely on frontier-only body
revalidation. Existing clients and endpoints remain wire-compatible.

Do not drop the index/tombstones/counters during application rollback. Older
binaries can continue using the additive schema and triggers. Database backup
restores that roll the revision history backward require clients to reconcile
again; ahead-of-head cursors are detected, but arbitrary divergent restores are
outside this cursor contract.
