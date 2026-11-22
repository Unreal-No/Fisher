-- CreateEnum
CREATE TYPE "CompBasis" AS ENUM ('GROSS_REVENUE', 'NET_PROFIT', 'CAUGHT_KG', 'SOLD_KG');

-- CreateEnum
CREATE TYPE "PayrollStatus" AS ENUM ('DRAFT', 'CALCULATED', 'APPROVED', 'PAID', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AdvanceKind" AS ENUM ('ADVANCE', 'LOAN');

-- CreateEnum
CREATE TYPE "AdvanceStatus" AS ENUM ('OPEN', 'SETTLED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PayItemCode" AS ENUM ('SALARY', 'DAILY_WAGE', 'TRIP_PAY', 'REVENUE_SHARE', 'CATCH_PAY', 'BONUS', 'OTHER_EARNING', 'ADVANCE_RECOVERY', 'LOAN_REPAYMENT', 'OTHER_DEDUCTION');

-- CreateTable
CREATE TABLE "compensation_rules" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "method" "PayType" NOT NULL,
    "vessel_id" UUID,
    "position" "EmployeePosition",
    "employee_id" UUID,
    "rate" DECIMAL(14,4) NOT NULL,
    "basis" "CompBasis",
    "effective_from" DATE NOT NULL,
    "effective_to" DATE,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "compensation_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employee_advances" (
    "id" UUID NOT NULL,
    "advance_no" TEXT NOT NULL,
    "employee_id" UUID NOT NULL,
    "kind" "AdvanceKind" NOT NULL,
    "advance_date" DATE NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "installment" DECIMAL(14,2),
    "recovered_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "status" "AdvanceStatus" NOT NULL DEFAULT 'OPEN',
    "method" "PaymentMethod" NOT NULL DEFAULT 'CASH',
    "reason" TEXT NOT NULL,
    "cancel_reason" TEXT,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "employee_advances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payroll_periods" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "pay_date" DATE,
    "vessel_id" UUID,
    "status" "PayrollStatus" NOT NULL DEFAULT 'DRAFT',
    "total_gross" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "total_deduction" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "total_net" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "notes" TEXT,
    "calculated_at" TIMESTAMPTZ,
    "calculated_by_id" UUID,
    "approved_at" TIMESTAMPTZ,
    "approved_by_id" UUID,
    "paid_at" TIMESTAMPTZ,
    "pay_method" "PaymentMethod",
    "pay_reference" TEXT,
    "cancel_reason" TEXT,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "payroll_periods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payroll_records" (
    "id" UUID NOT NULL,
    "period_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "vessel_id" UUID,
    "position" "EmployeePosition" NOT NULL,
    "gross" DECIMAL(14,2) NOT NULL,
    "deduction" DECIMAL(14,2) NOT NULL,
    "net" DECIMAL(14,2) NOT NULL,
    "warnings" JSONB,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payroll_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payroll_items" (
    "id" UUID NOT NULL,
    "record_id" UUID NOT NULL,
    "code" "PayItemCode" NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(14,3),
    "rate" DECIMAL(14,4),
    "amount" DECIMAL(14,2) NOT NULL,
    "trip_id" UUID,
    "rule_id" UUID,
    "advance_id" UUID,
    "calc" JSONB,

    CONSTRAINT "payroll_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payroll_adjustments" (
    "id" UUID NOT NULL,
    "period_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "code" "PayItemCode" NOT NULL,
    "description" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payroll_adjustments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "compensation_rules_vessel_id_position_idx" ON "compensation_rules"("vessel_id", "position");

-- CreateIndex
CREATE INDEX "compensation_rules_employee_id_idx" ON "compensation_rules"("employee_id");

-- CreateIndex
CREATE UNIQUE INDEX "employee_advances_advance_no_key" ON "employee_advances"("advance_no");

-- CreateIndex
CREATE INDEX "employee_advances_employee_id_status_idx" ON "employee_advances"("employee_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "payroll_periods_code_key" ON "payroll_periods"("code");

-- CreateIndex
CREATE INDEX "payroll_periods_status_idx" ON "payroll_periods"("status");

-- CreateIndex
CREATE INDEX "payroll_records_employee_id_idx" ON "payroll_records"("employee_id");

-- CreateIndex
CREATE UNIQUE INDEX "payroll_records_period_id_employee_id_key" ON "payroll_records"("period_id", "employee_id");

-- CreateIndex
CREATE INDEX "payroll_items_record_id_idx" ON "payroll_items"("record_id");

-- CreateIndex
CREATE INDEX "payroll_items_trip_id_idx" ON "payroll_items"("trip_id");

-- CreateIndex
CREATE INDEX "payroll_adjustments_period_id_idx" ON "payroll_adjustments"("period_id");

-- AddForeignKey
ALTER TABLE "employee_advances" ADD CONSTRAINT "employee_advances_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_records" ADD CONSTRAINT "payroll_records_period_id_fkey" FOREIGN KEY ("period_id") REFERENCES "payroll_periods"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_records" ADD CONSTRAINT "payroll_records_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_items" ADD CONSTRAINT "payroll_items_record_id_fkey" FOREIGN KEY ("record_id") REFERENCES "payroll_records"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_adjustments" ADD CONSTRAINT "payroll_adjustments_period_id_fkey" FOREIGN KEY ("period_id") REFERENCES "payroll_periods"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ===== Business-rule constraints =====
ALTER TABLE "compensation_rules" ADD CONSTRAINT "compensation_rules_rate_nonneg" CHECK ("rate" >= 0);
ALTER TABLE "compensation_rules" ADD CONSTRAINT "compensation_rules_dates" CHECK ("effective_to" IS NULL OR "effective_to" >= "effective_from");
ALTER TABLE "employee_advances" ADD CONSTRAINT "employee_advances_amounts" CHECK ("amount" > 0 AND "recovered_amount" >= 0 AND "recovered_amount" <= "amount" AND ("installment" IS NULL OR "installment" > 0));
ALTER TABLE "payroll_periods" ADD CONSTRAINT "payroll_periods_dates" CHECK ("end_date" >= "start_date");
ALTER TABLE "payroll_records" ADD CONSTRAINT "payroll_records_net_nonneg" CHECK ("net" >= 0 AND "gross" >= 0 AND "deduction" >= 0);
ALTER TABLE "payroll_items" ADD CONSTRAINT "payroll_items_amount_nonneg" CHECK ("amount" >= 0);
ALTER TABLE "payroll_adjustments" ADD CONSTRAINT "payroll_adjustments_amount_positive" CHECK ("amount" > 0);
