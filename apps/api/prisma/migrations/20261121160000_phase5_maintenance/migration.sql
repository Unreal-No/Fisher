-- CreateEnum
CREATE TYPE "MaintCategory" AS ENUM ('ENGINE', 'HULL', 'ELECTRICAL', 'HYDRAULIC', 'SAFETY', 'FISHING_GEAR', 'REFRIGERATION', 'DOCKING', 'OTHER');

-- CreateEnum
CREATE TYPE "MaintType" AS ENUM ('PREVENTIVE', 'CORRECTIVE', 'INSPECTION', 'DOCKING');

-- CreateEnum
CREATE TYPE "MaintStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "Priority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "EngineHourSource" AS ENUM ('MANUAL', 'TRIP_DEPARTURE', 'TRIP_ARRIVAL', 'MAINTENANCE');

-- CreateTable
CREATE TABLE "maintenance_plans" (
    "id" UUID NOT NULL,
    "vessel_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "category" "MaintCategory" NOT NULL,
    "interval_days" INTEGER,
    "interval_engine_hours" INTEGER,
    "last_done_at" DATE,
    "last_done_engine_hours" DECIMAL(10,1),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "maintenance_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "engine_hour_logs" (
    "id" UUID NOT NULL,
    "vessel_id" UUID NOT NULL,
    "recorded_at" TIMESTAMPTZ NOT NULL,
    "hours" DECIMAL(10,1) NOT NULL,
    "source" "EngineHourSource" NOT NULL DEFAULT 'MANUAL',
    "is_reset" BOOLEAN NOT NULL DEFAULT false,
    "trip_id" UUID,
    "order_id" UUID,
    "notes" TEXT,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "engine_hour_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "maintenance_orders" (
    "id" UUID NOT NULL,
    "order_no" TEXT NOT NULL,
    "vessel_id" UUID NOT NULL,
    "plan_id" UUID,
    "title" TEXT NOT NULL,
    "category" "MaintCategory" NOT NULL,
    "type" "MaintType" NOT NULL,
    "priority" "Priority" NOT NULL DEFAULT 'MEDIUM',
    "status" "MaintStatus" NOT NULL DEFAULT 'OPEN',
    "takes_out_of_service" BOOLEAN NOT NULL DEFAULT false,
    "reported_at" TIMESTAMPTZ NOT NULL,
    "started_at" TIMESTAMPTZ,
    "completed_at" TIMESTAMPTZ,
    "engine_hours" DECIMAL(10,1),
    "provider_id" UUID,
    "invoice_no" TEXT,
    "description" TEXT,
    "findings" TEXT,
    "labor_cost" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "external_cost" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "parts_cost" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "cancel_reason" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "maintenance_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "maintenance_attachments" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "file_id" UUID NOT NULL,
    "note" TEXT,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "maintenance_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "maintenance_plans_vessel_id_idx" ON "maintenance_plans"("vessel_id");

-- CreateIndex
CREATE INDEX "engine_hour_logs_vessel_id_recorded_at_idx" ON "engine_hour_logs"("vessel_id", "recorded_at");

-- CreateIndex
CREATE UNIQUE INDEX "maintenance_orders_order_no_key" ON "maintenance_orders"("order_no");

-- CreateIndex
CREATE INDEX "maintenance_orders_vessel_id_status_idx" ON "maintenance_orders"("vessel_id", "status");

-- CreateIndex
CREATE INDEX "maintenance_orders_status_idx" ON "maintenance_orders"("status");

-- CreateIndex
CREATE INDEX "maintenance_attachments_order_id_idx" ON "maintenance_attachments"("order_id");

-- AddForeignKey
ALTER TABLE "maintenance_plans" ADD CONSTRAINT "maintenance_plans_vessel_id_fkey" FOREIGN KEY ("vessel_id") REFERENCES "vessels"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "engine_hour_logs" ADD CONSTRAINT "engine_hour_logs_vessel_id_fkey" FOREIGN KEY ("vessel_id") REFERENCES "vessels"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_orders" ADD CONSTRAINT "maintenance_orders_vessel_id_fkey" FOREIGN KEY ("vessel_id") REFERENCES "vessels"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_orders" ADD CONSTRAINT "maintenance_orders_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "maintenance_plans"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_orders" ADD CONSTRAINT "maintenance_orders_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_attachments" ADD CONSTRAINT "maintenance_attachments_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "maintenance_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ===== Business-rule constraints =====
ALTER TABLE "maintenance_plans" ADD CONSTRAINT "maintenance_plans_has_interval" CHECK ("interval_days" IS NOT NULL OR "interval_engine_hours" IS NOT NULL);
ALTER TABLE "maintenance_plans" ADD CONSTRAINT "maintenance_plans_interval_positive" CHECK (("interval_days" IS NULL OR "interval_days" > 0) AND ("interval_engine_hours" IS NULL OR "interval_engine_hours" > 0));
ALTER TABLE "engine_hour_logs" ADD CONSTRAINT "engine_hour_logs_nonneg" CHECK ("hours" >= 0);
ALTER TABLE "maintenance_orders" ADD CONSTRAINT "maintenance_orders_costs_nonneg" CHECK ("labor_cost" >= 0 AND "external_cost" >= 0 AND "parts_cost" >= 0);
ALTER TABLE "maintenance_orders" ADD CONSTRAINT "maintenance_orders_completed_after_start" CHECK ("completed_at" IS NULL OR "started_at" IS NULL OR "completed_at" >= "started_at");
