-- Account is the durable authority for a credential replacement.  The nonce
-- distinguishes two operations even when a delayed external write observes an
-- older credential value.
ALTER TABLE "Account" ADD COLUMN "vercelConnectionNonce" TEXT;

-- `NULL` team IDs written before scope provenance existed are ambiguous: they
-- might mean a personal account or merely an old row that never persisted its
-- selected scope.  Keep those provider-bound rows unknown until a read-only
-- provider lookup proves their scope.  New rows default to known.
ALTER TABLE "InteractivePreview" ADD COLUMN "vercelScopeKnown" BOOLEAN NOT NULL DEFAULT false;
UPDATE "InteractivePreview"
SET "vercelScopeKnown" = true
WHERE "vercelTeamId" IS NOT NULL;
ALTER TABLE "InteractivePreview" ALTER COLUMN "vercelScopeKnown" SET DEFAULT true;
