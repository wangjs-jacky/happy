-- The encrypted service-token repository is outside Account's database
-- transaction.  Keep a durable database fence while a callback drains an old
-- provider scope and conditionally writes its replacement credential.
ALTER TABLE "Account" ADD COLUMN "vercelConnectionState" TEXT NOT NULL DEFAULT 'active';
ALTER TABLE "Account" ADD COLUMN "vercelConnectionReplacementId" TEXT;
ALTER TABLE "Account" ADD COLUMN "vercelConnectionReplacementStartedAt" TIMESTAMP(3);
