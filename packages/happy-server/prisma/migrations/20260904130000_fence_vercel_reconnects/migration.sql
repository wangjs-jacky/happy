-- OAuth credentials stay encrypted in ServiceAccountToken. These values are
-- non-secret lifecycle fences/scope metadata only.
ALTER TABLE "Account" ADD COLUMN "vercelConnectionEpoch" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "InteractivePreview" ADD COLUMN "vercelTeamId" TEXT;
