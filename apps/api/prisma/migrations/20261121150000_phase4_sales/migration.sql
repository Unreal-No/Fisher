-- CreateEnum
CREATE TYPE "SalesStatus" AS ENUM ('DRAFT', 'CONFIRMED', 'VOID');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'TRANSFER', 'CHEQUE', 'OTHER');

-- CreateTable
CREATE TABLE "customers" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tax_id" TEXT,
    "branch" TEXT,
    "contact_name" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "address" TEXT,
    "credit_term_days" INTEGER,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_invoices" (
    "id" UUID NOT NULL,
    "order_no" TEXT NOT NULL,
    "invoice_no" TEXT,
    "status" "SalesStatus" NOT NULL DEFAULT 'DRAFT',
    "customer_id" UUID NOT NULL,
    "invoice_date" DATE NOT NULL,
    "due_date" DATE,
    "subtotal" DECIMAL(14,2) NOT NULL,
    "discount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "additional_cost" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "vat_rate" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "vat_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(14,2) NOT NULL,
    "paid_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "credited_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "notes" TEXT,
    "confirmed_at" TIMESTAMPTZ,
    "confirmed_by_id" UUID,
    "voided_at" TIMESTAMPTZ,
    "void_reason" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "sales_invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_items" (
    "id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "trip_id" UUID NOT NULL,
    "vessel_id" UUID NOT NULL,
    "species_id" UUID NOT NULL,
    "grade_id" UUID,
    "description" TEXT NOT NULL,
    "weight_kg" DECIMAL(12,3) NOT NULL,
    "quantity" INTEGER,
    "unit_price" DECIMAL(12,4) NOT NULL,
    "line_total" DECIMAL(14,2) NOT NULL,
    "discount_share" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "returned_kg" DECIMAL(12,3) NOT NULL DEFAULT 0,
    "returned_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,

    CONSTRAINT "sales_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_payments" (
    "id" UUID NOT NULL,
    "receipt_no" TEXT NOT NULL,
    "invoice_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "paid_at" TIMESTAMPTZ NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "reference" TEXT,
    "notes" TEXT,
    "voided_at" TIMESTAMPTZ,
    "void_reason" TEXT,
    "voided_by_id" UUID,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sales_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_returns" (
    "id" UUID NOT NULL,
    "credit_note_no" TEXT NOT NULL,
    "invoice_id" UUID NOT NULL,
    "return_date" DATE NOT NULL,
    "reason" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sales_returns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_return_items" (
    "id" UUID NOT NULL,
    "return_id" UUID NOT NULL,
    "sales_item_id" UUID NOT NULL,
    "weight_kg" DECIMAL(12,3) NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,

    CONSTRAINT "sales_return_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "customers_code_key" ON "customers"("code");

-- CreateIndex
CREATE UNIQUE INDEX "sales_invoices_order_no_key" ON "sales_invoices"("order_no");

-- CreateIndex
CREATE UNIQUE INDEX "sales_invoices_invoice_no_key" ON "sales_invoices"("invoice_no");

-- CreateIndex
CREATE INDEX "sales_invoices_status_invoice_date_idx" ON "sales_invoices"("status", "invoice_date");

-- CreateIndex
CREATE INDEX "sales_invoices_customer_id_invoice_date_idx" ON "sales_invoices"("customer_id", "invoice_date");

-- CreateIndex
CREATE INDEX "sales_items_invoice_id_idx" ON "sales_items"("invoice_id");

-- CreateIndex
CREATE INDEX "sales_items_trip_id_species_id_grade_id_idx" ON "sales_items"("trip_id", "species_id", "grade_id");

-- CreateIndex
CREATE UNIQUE INDEX "sales_payments_receipt_no_key" ON "sales_payments"("receipt_no");

-- CreateIndex
CREATE INDEX "sales_payments_invoice_id_idx" ON "sales_payments"("invoice_id");

-- CreateIndex
CREATE INDEX "sales_payments_customer_id_paid_at_idx" ON "sales_payments"("customer_id", "paid_at");

-- CreateIndex
CREATE UNIQUE INDEX "sales_returns_credit_note_no_key" ON "sales_returns"("credit_note_no");

-- CreateIndex
CREATE INDEX "sales_returns_invoice_id_idx" ON "sales_returns"("invoice_id");

-- AddForeignKey
ALTER TABLE "sales_invoices" ADD CONSTRAINT "sales_invoices_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_items" ADD CONSTRAINT "sales_items_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "sales_invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_items" ADD CONSTRAINT "sales_items_trip_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "fishing_trips"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_items" ADD CONSTRAINT "sales_items_species_id_fkey" FOREIGN KEY ("species_id") REFERENCES "fish_species"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_items" ADD CONSTRAINT "sales_items_grade_id_fkey" FOREIGN KEY ("grade_id") REFERENCES "catch_grades"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_payments" ADD CONSTRAINT "sales_payments_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "sales_invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_payments" ADD CONSTRAINT "sales_payments_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_returns" ADD CONSTRAINT "sales_returns_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "sales_invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_return_items" ADD CONSTRAINT "sales_return_items_return_id_fkey" FOREIGN KEY ("return_id") REFERENCES "sales_returns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_return_items" ADD CONSTRAINT "sales_return_items_sales_item_id_fkey" FOREIGN KEY ("sales_item_id") REFERENCES "sales_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ===== Business-rule constraints =====
ALTER TABLE "sales_items" ADD CONSTRAINT "sales_items_weight_positive" CHECK ("weight_kg" > 0);
ALTER TABLE "sales_items" ADD CONSTRAINT "sales_items_returned_le_sold" CHECK ("returned_kg" >= 0 AND "returned_kg" <= "weight_kg" AND "returned_amount" >= 0 AND "returned_amount" <= "line_total");
ALTER TABLE "sales_invoices" ADD CONSTRAINT "sales_invoices_settled_le_total" CHECK ("paid_amount" >= 0 AND "credited_amount" >= 0 AND "paid_amount" + "credited_amount" <= "total");
ALTER TABLE "sales_invoices" ADD CONSTRAINT "sales_invoices_confirmed_has_number" CHECK ("status" = 'DRAFT' OR "invoice_no" IS NOT NULL);
ALTER TABLE "sales_payments" ADD CONSTRAINT "sales_payments_amount_positive" CHECK ("amount" > 0);
ALTER TABLE "sales_return_items" ADD CONSTRAINT "sales_return_items_positive" CHECK ("weight_kg" > 0 AND "amount" > 0);
