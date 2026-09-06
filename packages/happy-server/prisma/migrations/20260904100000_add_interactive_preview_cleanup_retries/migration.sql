ALTER TABLE "InteractivePreview" ADD COLUMN "cleanupRetryCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "InteractivePreview" ADD COLUMN "cleanupNextAttemptAt" TIMESTAMP(3);
CREATE INDEX "InteractivePreview_status_cleanupNextAttemptAt_idx" ON "InteractivePreview"("status", "cleanupNextAttemptAt");
