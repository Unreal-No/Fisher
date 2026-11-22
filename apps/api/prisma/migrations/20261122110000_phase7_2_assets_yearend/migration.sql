-- CreateEnum
CREATE TYPE "AssetCategory" AS ENUM ('VESSEL', 'ENGINE', 'FISHING_GEAR', 'EQUIPMENT', 'VEHICLE', 'BUILDING', 'OTHER');

-- CreateEnum
CREATE TYPE "AssetStatus" AS ENUM ('ACTIVE', 'DISPOSED');

-- AlterEnum
ALTER TYPE "PayItemCode" ADD VALUE 'WITHHOLDING_TAX';

-- CreateTable
CREATE TABLE "fixed_assets" (
    "id" UUID NOT NULL,
    "asset_no" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" "AssetCategory" NOT NULL,
    "vessel_id" UUID,
    "acquisition_date" DATE NOT NULL,
    "dep_start_date" DATE NOT NULL,
    "cost" DECIMAL(14,2) NOT NULL,
    "salvage_value" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "useful_life_months" INTEGER NOT NULL,
    "asset_account_id" UUID NOT NULL,
    "accum_dep_account_id" UUID NOT NULL,
    "dep_expense_account_id" UUID NOT NULL,
    "serial_no" TEXT,
    "status" "AssetStatus" NOT NULL DEFAULT 'ACTIVE',
    "disposed_at" DATE,
    "disposal_proceeds" DECIMAL(14,2),
    "disposal_reason" TEXT,
    "notes" TEXT,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "fixed_assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "depreciation_runs" (
    "id" UUID NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "total" DECIMAL(14,2) NOT NULL,
    "entry_id" UUID,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "depreciation_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "depreciation_lines" (
    "id" UUID NOT NULL,
    "run_id" UUID NOT NULL,
    "asset_id" UUID NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,

    CONSTRAINT "depreciation_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fiscal_years" (
    "id" UUID NOT NULL,
    "year" INTEGER NOT NULL,
    "status" "FiscalStatus" NOT NULL DEFAULT 'OPEN',
    "closing_entry_id" UUID,
    "closed_at" TIMESTAMPTZ,
    "closed_by_id" UUID,
    "reopened_at" TIMESTAMPTZ,
    "reopen_reason" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "fiscal_years_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "fixed_assets_asset_no_key" ON "fixed_assets"("asset_no");

-- CreateIndex
CREATE INDEX "fixed_assets_status_idx" ON "fixed_assets"("status");

-- CreateIndex
CREATE UNIQUE INDEX "depreciation_runs_year_month_key" ON "depreciation_runs"("year", "month");

-- CreateIndex
CREATE INDEX "depreciation_lines_asset_id_idx" ON "depreciation_lines"("asset_id");

-- CreateIndex
CREATE UNIQUE INDEX "depreciation_lines_run_id_asset_id_key" ON "depreciation_lines"("run_id", "asset_id");

-- CreateIndex
CREATE UNIQUE INDEX "fiscal_years_year_key" ON "fiscal_years"("year");

-- AddForeignKey
ALTER TABLE "fixed_assets" ADD CONSTRAINT "fixed_assets_vessel_id_fkey" FOREIGN KEY ("vessel_id") REFERENCES "vessels"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fixed_assets" ADD CONSTRAINT "fixed_assets_asset_account_id_fkey" FOREIGN KEY ("asset_account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fixed_assets" ADD CONSTRAINT "fixed_assets_accum_dep_account_id_fkey" FOREIGN KEY ("accum_dep_account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fixed_assets" ADD CONSTRAINT "fixed_assets_dep_expense_account_id_fkey" FOREIGN KEY ("dep_expense_account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "depreciation_lines" ADD CONSTRAINT "depreciation_lines_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "depreciation_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "depreciation_lines" ADD CONSTRAINT "depreciation_lines_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "fixed_assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ===== custom integrity (hand-written) =====
ALTER TABLE "fixed_assets" ADD CONSTRAINT "fixed_assets_values_chk"
  CHECK (cost > 0 AND salvage_value >= 0 AND salvage_value < cost AND useful_life_months > 0 AND dep_start_date >= acquisition_date - INTERVAL '31 days'
         AND (status = 'ACTIVE' OR disposed_at IS NOT NULL) AND (disposal_proceeds IS NULL OR disposal_proceeds >= 0));
ALTER TABLE "depreciation_runs" ADD CONSTRAINT "depreciation_runs_month_chk" CHECK (month BETWEEN 1 AND 12 AND total >= 0);
ALTER TABLE "depreciation_lines" ADD CONSTRAINT "depreciation_lines_amount_chk" CHECK (amount > 0);
