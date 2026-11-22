-- CreateEnum
CREATE TYPE "EmailStatus" AS ENUM ('SIMULATED', 'SENT', 'FAILED');

-- CreateTable
CREATE TABLE "email_outbox" (
    "id" UUID NOT NULL,
    "to" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "status" "EmailStatus" NOT NULL,
    "error" TEXT,
    "related_type" TEXT,
    "related_id" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sent_at" TIMESTAMPTZ,

    CONSTRAINT "email_outbox_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "email_outbox_created_at_idx" ON "email_outbox"("created_at");

-- CreateIndex
CREATE INDEX "email_outbox_to_created_at_idx" ON "email_outbox"("to", "created_at");

