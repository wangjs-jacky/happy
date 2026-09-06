-- Backfill and trigger installation must form one atomic cutover. Block writers
-- during the snapshot so no old-binary write can fall between these operations.
BEGIN;
LOCK TABLE "Session", "SessionMessage" IN SHARE ROW EXCLUSIVE MODE;

CREATE TABLE "SessionChangeCounter" (
    "accountId" TEXT PRIMARY KEY REFERENCES "Account"("id") ON DELETE CASCADE,
    "revision" BIGINT NOT NULL DEFAULT 0
);
CREATE TABLE "SessionChange" (
    "accountId" TEXT NOT NULL REFERENCES "Account"("id") ON DELETE CASCADE,
    "sessionId" TEXT NOT NULL,
    "revision" BIGINT NOT NULL,
    "deleted" BOOLEAN NOT NULL DEFAULT false,
    "lastMessageSeq" INTEGER NOT NULL DEFAULT 0,
    "metadataVersion" INTEGER NOT NULL DEFAULT 0,
    "agentStateVersion" INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY ("accountId", "sessionId")
);
CREATE UNIQUE INDEX "SessionChange_accountId_revision_key" ON "SessionChange"("accountId", "revision");

INSERT INTO "SessionChange" ("accountId", "sessionId", "revision", "lastMessageSeq", "metadataVersion", "agentStateVersion")
SELECT s."accountId", s."id", row_number() OVER (PARTITION BY s."accountId" ORDER BY s."id"),
    COALESCE((SELECT max(m."seq") FROM "SessionMessage" m WHERE m."sessionId" = s."id"), 0),
    s."metadataVersion", s."agentStateVersion"
FROM "Session" s;
INSERT INTO "SessionChangeCounter" ("accountId", "revision")
SELECT "accountId", max("revision") FROM "SessionChange" GROUP BY "accountId";

CREATE FUNCTION paws_record_session_change(a TEXT, s TEXT, d BOOLEAN, msg_seq INTEGER, metadata_version INTEGER, state_version INTEGER)
RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE next_revision BIGINT;
BEGIN
    -- This row remains locked until the enclosing mutation commits or rolls
    -- back. Readers cannot advance past a revision whose write is still pending.
    INSERT INTO "SessionChangeCounter" ("accountId", "revision") VALUES (a, 1)
    ON CONFLICT ("accountId") DO UPDATE SET "revision" = "SessionChangeCounter"."revision" + 1
    RETURNING "revision" INTO next_revision;

    INSERT INTO "SessionChange" ("accountId", "sessionId", "revision", "deleted", "lastMessageSeq", "metadataVersion", "agentStateVersion")
    VALUES (a, s, next_revision, d, msg_seq, metadata_version, state_version)
    ON CONFLICT ("accountId", "sessionId") DO UPDATE SET
        "revision" = EXCLUDED."revision", "deleted" = EXCLUDED."deleted",
        "lastMessageSeq" = GREATEST("SessionChange"."lastMessageSeq", EXCLUDED."lastMessageSeq"),
        "metadataVersion" = EXCLUDED."metadataVersion", "agentStateVersion" = EXCLUDED."agentStateVersion";
END;
$$;

CREATE FUNCTION paws_session_change_trigger() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        PERFORM paws_record_session_change(OLD."accountId", OLD."id", true, 0, OLD."metadataVersion", OLD."agentStateVersion");
        RETURN OLD;
    END IF;
    IF TG_OP = 'INSERT' OR NEW."metadataVersion" IS DISTINCT FROM OLD."metadataVersion"
        OR NEW."agentStateVersion" IS DISTINCT FROM OLD."agentStateVersion" THEN
        PERFORM paws_record_session_change(NEW."accountId", NEW."id", false, 0, NEW."metadataVersion", NEW."agentStateVersion");
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER paws_session_change AFTER INSERT OR UPDATE OR DELETE ON "Session"
FOR EACH ROW EXECUTE FUNCTION paws_session_change_trigger();

CREATE FUNCTION paws_message_change_trigger() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE s "Session"%ROWTYPE;
BEGIN
    -- Serialize with metadata/deletion and the REST/socket sequence allocator.
    SELECT * INTO STRICT s FROM "Session" WHERE "id" = NEW."sessionId" FOR UPDATE;
    PERFORM paws_record_session_change(s."accountId", s."id", false, NEW."seq", s."metadataVersion", s."agentStateVersion");
    RETURN NEW;
END;
$$;
CREATE TRIGGER paws_message_change AFTER INSERT ON "SessionMessage"
FOR EACH ROW EXECUTE FUNCTION paws_message_change_trigger();
COMMIT;
