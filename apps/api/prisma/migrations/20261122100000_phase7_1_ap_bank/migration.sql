-- CreateEnum
CREATE TYPE "VendorBillStatus" AS ENUM ('DRAFT', 'APPROVED', 'VOID');

-- CreateEnum
CREATE TYPE "BillLineKind" AS ENUM ('GR', 'EXPENSE');

-- CreateEnum
CREATE TYPE "VendorPaymentStatus" AS ENUM ('POSTED', 'VOID');

-- CreateEnum
CREATE TYPE "BankRecStatus" AS ENUM ('DRAFT', 'COMPLETED');

-- AlterTable
ALTER TABLE "suppliers" ADD COLUMN     "is_individual" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "bank_accounts" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "bank_name" TEXT NOT NULL,
    "account_no" TEXT NOT NULL,
    "gl_account_id" UUID NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "bank_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vendor_bills" (
    "id" UUID NOT NULL,
    "bill_no" TEXT NOT NULL,
    "supplier_id" UUID NOT NULL,
    "supplier_invoice_no" TEXT NOT NULL,
    "bill_date" DATE NOT NULL,
    "due_date" DATE,
    "status" "VendorBillStatus" NOT NULL DEFAULT 'DRAFT',
    "subtotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "vat_rate" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "vat_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "paid_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "notes" TEXT,
    "created_by_id" UUID,
    "approved_at" TIMESTAMPTZ,
    "approved_by_id" UUID,
    "voided_at" TIMESTAMPTZ,
    "void_reason" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "vendor_bills_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vendor_bill_lines" (
    "id" UUID NOT NULL,
    "bill_id" UUID NOT NULL,
    "line_no" INTEGER NOT NULL,
    "kind" "BillLineKind" NOT NULL,
    "goods_receipt_id" UUID,
    "account_id" UUID,
    "description" TEXT,
    "amount" DECIMAL(14,2) NOT NULL,
    "vessel_id" UUID,
    "trip_id" UUID,

    CONSTRAINT "vendor_bill_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vendor_payments" (
    "id" UUID NOT NULL,
    "payment_no" TEXT NOT NULL,
    "supplier_id" UUID NOT NULL,
    "paid_at" TIMESTAMPTZ NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "bank_account_id" UUID,
    "reference" TEXT,
    "gross_amount" DECIMAL(14,2) NOT NULL,
    "wht_rate" DECIMAL(5,2),
    "wht_base" DECIMAL(14,2),
    "wht_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "net_amount" DECIMAL(14,2) NOT NULL,
    "status" "VendorPaymentStatus" NOT NULL DEFAULT 'POSTED',
    "notes" TEXT,
    "created_by_id" UUID,
    "voided_at" TIMESTAMPTZ,
    "void_reason" TEXT,
    "voided_by_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vendor_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vendor_payment_allocations" (
    "id" UUID NOT NULL,
    "payment_id" UUID NOT NULL,
    "bill_id" UUID NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,

    CONSTRAINT "vendor_payment_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bank_reconciliations" (
    "id" UUID NOT NULL,
    "bank_account_id" UUID NOT NULL,
    "statement_date" DATE NOT NULL,
    "statement_balance" DECIMAL(16,2) NOT NULL,
    "status" "BankRecStatus" NOT NULL DEFAULT 'DRAFT',
    "notes" TEXT,
    "created_by_id" UUID,
    "completed_at" TIMESTAMPTZ,
    "completed_by_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "bank_reconciliations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bank_rec_items" (
    "id" UUID NOT NULL,
    "reconciliation_id" UUID NOT NULL,
    "journal_line_id" UUID NOT NULL,

    CONSTRAINT "bank_rec_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "bank_accounts_code_key" ON "bank_accounts"("code");

-- CreateIndex
CREATE UNIQUE INDEX "vendor_bills_bill_no_key" ON "vendor_bills"("bill_no");

-- CreateIndex
CREATE INDEX "vendor_bills_supplier_id_status_idx" ON "vendor_bills"("supplier_id", "status");

-- CreateIndex
CREATE INDEX "vendor_bill_lines_bill_id_idx" ON "vendor_bill_lines"("bill_id");

-- CreateIndex
CREATE INDEX "vendor_bill_lines_goods_receipt_id_idx" ON "vendor_bill_lines"("goods_receipt_id");

-- CreateIndex
CREATE UNIQUE INDEX "vendor_payments_payment_no_key" ON "vendor_payments"("payment_no");

-- CreateIndex
CREATE INDEX "vendor_payments_supplier_id_idx" ON "vendor_payments"("supplier_id");

-- CreateIndex
CREATE INDEX "vendor_payments_paid_at_idx" ON "vendor_payments"("paid_at");

-- CreateIndex
CREATE INDEX "vendor_payment_allocations_bill_id_idx" ON "vendor_payment_allocations"("bill_id");

-- CreateIndex
CREATE UNIQUE INDEX "vendor_payment_allocations_payment_id_bill_id_key" ON "vendor_payment_allocations"("payment_id", "bill_id");

-- CreateIndex
CREATE INDEX "bank_reconciliations_bank_account_id_statement_date_idx" ON "bank_reconciliations"("bank_account_id", "statement_date");

-- CreateIndex
CREATE UNIQUE INDEX "bank_rec_items_journal_line_id_key" ON "bank_rec_items"("journal_line_id");

-- CreateIndex
CREATE INDEX "bank_rec_items_reconciliation_id_idx" ON "bank_rec_items"("reconciliation_id");

-- AddForeignKey
ALTER TABLE "bank_accounts" ADD CONSTRAINT "bank_accounts_gl_account_id_fkey" FOREIGN KEY ("gl_account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_bills" ADD CONSTRAINT "vendor_bills_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_bill_lines" ADD CONSTRAINT "vendor_bill_lines_bill_id_fkey" FOREIGN KEY ("bill_id") REFERENCES "vendor_bills"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_bill_lines" ADD CONSTRAINT "vendor_bill_lines_goods_receipt_id_fkey" FOREIGN KEY ("goods_receipt_id") REFERENCES "goods_receipts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_bill_lines" ADD CONSTRAINT "vendor_bill_lines_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_bill_lines" ADD CONSTRAINT "vendor_bill_lines_vessel_id_fkey" FOREIGN KEY ("vessel_id") REFERENCES "vessels"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_bill_lines" ADD CONSTRAINT "vendor_bill_lines_trip_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "fishing_trips"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_payments" ADD CONSTRAINT "vendor_payments_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_payments" ADD CONSTRAINT "vendor_payments_bank_account_id_fkey" FOREIGN KEY ("bank_account_id") REFERENCES "bank_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_payment_allocations" ADD CONSTRAINT "vendor_payment_allocations_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "vendor_payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_payment_allocations" ADD CONSTRAINT "vendor_payment_allocations_bill_id_fkey" FOREIGN KEY ("bill_id") REFERENCES "vendor_bills"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_reconciliations" ADD CONSTRAINT "bank_reconciliations_bank_account_id_fkey" FOREIGN KEY ("bank_account_id") REFERENCES "bank_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_rec_items" ADD CONSTRAINT "bank_rec_items_reconciliation_id_fkey" FOREIGN KEY ("reconciliation_id") REFERENCES "bank_reconciliations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_rec_items" ADD CONSTRAINT "bank_rec_items_journal_line_id_fkey" FOREIGN KEY ("journal_line_id") REFERENCES "journal_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ===== custom integrity (hand-written) =====
ALTER TABLE "vendor_bills" ADD CONSTRAINT "vendor_bills_amounts_chk"
  CHECK (subtotal >= 0 AND vat_amount >= 0 AND total = subtotal + vat_amount AND paid_amount >= 0 AND paid_amount <= total);
ALTER TABLE "vendor_bill_lines" ADD CONSTRAINT "vendor_bill_lines_kind_chk"
  CHECK (amount > 0 AND ((kind = 'GR' AND goods_receipt_id IS NOT NULL AND account_id IS NULL) OR (kind = 'EXPENSE' AND account_id IS NOT NULL AND goods_receipt_id IS NULL)));
ALTER TABLE "vendor_payments" ADD CONSTRAINT "vendor_payments_amounts_chk"
  CHECK (gross_amount > 0 AND wht_amount >= 0 AND wht_amount < gross_amount AND net_amount = gross_amount - wht_amount);
ALTER TABLE "vendor_payment_allocations" ADD CONSTRAINT "vendor_payment_allocations_amount_chk" CHECK (amount > 0);
-- the same supplier invoice number cannot be entered twice (voided bills excepted)
CREATE UNIQUE INDEX "vendor_bills_supplier_invoice_key" ON "vendor_bills" ("supplier_id", "supplier_invoice_no") WHERE status <> 'VOID';
