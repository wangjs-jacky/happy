ALTER TABLE "Account" ADD COLUMN "codexAccountsMigratedAt" TIMESTAMP(3);

CREATE TABLE "CodexAccountProfile" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "accountId" TEXT NOT NULL REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    "displayName" TEXT NOT NULL,
    "externalAccountFingerprint" TEXT NOT NULL,
    "credential" BYTEA NOT NULL,
    "credentialVersion" INTEGER NOT NULL DEFAULT 1 CHECK ("credentialVersion" > 0),
    "status" TEXT NOT NULL DEFAULT 'available' CHECK ("status" IN ('available', 'needs-refresh', 'invalid')),
    "lastValidatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX "CodexAccountProfile_accountId_externalAccountFingerprint_key" ON "CodexAccountProfile"("accountId", "externalAccountFingerprint");
CREATE UNIQUE INDEX "CodexAccountProfile_accountId_displayName_key" ON "CodexAccountProfile"("accountId", "displayName");

ALTER TABLE "Machine" ADD COLUMN "defaultCodexAccountProfileId" TEXT REFERENCES "CodexAccountProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Machine" ADD COLUMN "codexAccountBindingVersion" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "CodexQuotaSnapshot" (
    "codexAccountProfileId" TEXT NOT NULL PRIMARY KEY REFERENCES "CodexAccountProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    "weeklyUsedPercent" DOUBLE PRECISION NOT NULL CHECK ("weeklyUsedPercent" >= 0 AND "weeklyUsedPercent" <= 100),
    "weeklyResetsAt" TIMESTAMP(3) NOT NULL,
    "observedAt" TIMESTAMP(3) NOT NULL,
    "credentialVersion" INTEGER NOT NULL,
    "sourceSessionId" TEXT NOT NULL
);

CREATE TABLE "CodexSessionGrant" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "accountId" TEXT NOT NULL REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    "machineId" TEXT NOT NULL,
    "codexAccountProfileId" TEXT NOT NULL,
    "displayNameSnapshot" TEXT NOT NULL,
    "credentialVersion" INTEGER NOT NULL,
    "lastCredentialVersion" INTEGER NOT NULL,
    "bindingVersion" INTEGER NOT NULL,
    "digest" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "redeemedAt" TIMESTAMP(3),
    "sourceSessionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "CodexSessionGrant_digest_key" ON "CodexSessionGrant"("digest");
CREATE INDEX "CodexSessionGrant_accountId_codexAccountProfileId_idx" ON "CodexSessionGrant"("accountId", "codexAccountProfileId");
CREATE INDEX "CodexSessionGrant_expiresAt_idx" ON "CodexSessionGrant"("expiresAt");

CREATE TABLE "CodexAccountAudit" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "accountId" TEXT NOT NULL REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    "action" TEXT NOT NULL,
    "profileId" TEXT,
    "machineId" TEXT,
    "credentialVersion" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "CodexAccountAudit_accountId_createdAt_idx" ON "CodexAccountAudit"("accountId", "createdAt");
