CREATE TABLE "InteractivePreview" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "manifest" JSONB NOT NULL,
    "vercelDeploymentId" TEXT,
    "url" TEXT,
    "publishedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "cleanupClaimedAt" TIMESTAMP(3),
    "errorCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "InteractivePreview_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "InteractivePreviewAsset" (
    "previewId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "uploadedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "InteractivePreviewAsset_pkey" PRIMARY KEY ("previewId", "id")
);

CREATE INDEX "InteractivePreview_accountId_createdAt_idx" ON "InteractivePreview"("accountId", "createdAt" DESC);
CREATE INDEX "InteractivePreview_status_expiresAt_idx" ON "InteractivePreview"("status", "expiresAt");
CREATE UNIQUE INDEX "InteractivePreviewAsset_previewId_path_key" ON "InteractivePreviewAsset"("previewId", "path");
ALTER TABLE "InteractivePreview" ADD CONSTRAINT "InteractivePreview_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InteractivePreview" ADD CONSTRAINT "InteractivePreview_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InteractivePreviewAsset" ADD CONSTRAINT "InteractivePreviewAsset_previewId_fkey" FOREIGN KEY ("previewId") REFERENCES "InteractivePreview"("id") ON DELETE CASCADE ON UPDATE CASCADE;
