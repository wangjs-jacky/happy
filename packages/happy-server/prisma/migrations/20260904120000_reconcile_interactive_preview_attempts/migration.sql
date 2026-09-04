ALTER TABLE "InteractivePreview" ADD COLUMN "publicationCreateStartedAt" TIMESTAMP(3);
ALTER TABLE "InteractivePreview" ADD COLUMN "publicationReconcileRetryCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "InteractivePreview" ADD COLUMN "publicationReconcileNextAttemptAt" TIMESTAMP(3);
CREATE INDEX "InteractivePreview_status_publicationReconcileNextAttemptAt_idx" ON "InteractivePreview"("status", "publicationReconcileNextAttemptAt");

-- Earlier versions persisted the attempt ID but could classify an
-- acknowledgement-timeout as `failed`. Treat every such legacy attempt as
-- externally ambiguous: reconcile it before it may ever be retried or
-- cleaned. A deleting tombstone without an ID gets the same durable lookup
-- cadence without changing its deletion state.
UPDATE "InteractivePreview"
SET
    "status" = 'publishing',
    "errorCode" = 'PUBLISH_RECONCILIATION_PENDING',
    "publicationCreateStartedAt" = COALESCE("publicationCreateStartedAt", "updatedAt"),
    "publicationReconcileNextAttemptAt" = COALESCE("publicationReconcileNextAttemptAt", "updatedAt")
WHERE "publicationAttemptId" IS NOT NULL
  AND "status" IN ('publishing', 'failed');

UPDATE "InteractivePreview"
SET
    "publicationCreateStartedAt" = COALESCE("publicationCreateStartedAt", "updatedAt"),
    "publicationReconcileNextAttemptAt" = COALESCE("publicationReconcileNextAttemptAt", "updatedAt")
WHERE "publicationAttemptId" IS NOT NULL
  AND "status" = 'deleting'
  AND "vercelDeploymentId" IS NULL;
