-- CreateEnum
CREATE TYPE "AccountType" AS ENUM ('ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE');

-- CreateEnum
CREATE TYPE "NormalBalance" AS ENUM ('DEBIT', 'CREDIT');

-- CreateEnum
CREATE TYPE "JournalStatus" AS ENUM ('DRAFT', 'POSTED', 'REVERSED', 'VOID');

-- CreateEnum
CREATE TYPE "FiscalStatus" AS ENUM ('OPEN', 'CLOSED');

-- CreateTable
CREATE TABLE "accounts" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name_th" TEXT NOT NULL,
    "name_en" TEXT,
    "type" "AccountType" NOT NULL,
    "normal_balance" "NormalBalance" NOT NULL,
    "parent_id" UUID,
    "is_postable" BOOLEAN NOT NULL DEFAULT true,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "description" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "account_mappings" (
    "key" TEXT NOT NULL,
    "account_id" UUID NOT NULL,
    "updated_by_id" UUID,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "account_mappings_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "fiscal_periods" (
    "id" UUID NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "status" "FiscalStatus" NOT NULL DEFAULT 'OPEN',
    "closed_at" TIMESTAMPTZ,
    "closed_by_id" UUID,
    "reopened_at" TIMESTAMPTZ,
    "reopen_reason" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "fiscal_periods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "journal_entries" (
    "id" UUID NOT NULL,
    "entry_no" TEXT NOT NULL,
    "entry_date" DATE NOT NULL,
    "status" "JournalStatus" NOT NULL DEFAULT 'DRAFT',
    "memo" TEXT NOT NULL,
    "reference" TEXT,
    "source_type" TEXT,
    "source_id" UUID,
    "source_event" TEXT,
    "source_ref" TEXT,
    "total_debit" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "total_credit" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "reversal_of_id" UUID,
    "created_by_id" UUID,
    "posted_at" TIMESTAMPTZ,
    "posted_by_id" UUID,
    "reversed_at" TIMESTAMPTZ,
    "reverse_reason" TEXT,
    "voided_at" TIMESTAMPTZ,
    "void_reason" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "journal_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "journal_lines" (
    "id" UUID NOT NULL,
    "entry_id" UUID NOT NULL,
    "line_no" INTEGER NOT NULL,
    "account_id" UUID NOT NULL,
    "debit" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "credit" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "description" TEXT,
    "vessel_id" UUID,
    "trip_id" UUID,

    CONSTRAINT "journal_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "accounts_code_key" ON "accounts"("code");

-- CreateIndex
CREATE INDEX "accounts_type_idx" ON "accounts"("type");

-- CreateIndex
CREATE UNIQUE INDEX "fiscal_periods_year_month_key" ON "fiscal_periods"("year", "month");

-- CreateIndex
CREATE UNIQUE INDEX "journal_entries_entry_no_key" ON "journal_entries"("entry_no");

-- CreateIndex
CREATE UNIQUE INDEX "journal_entries_reversal_of_id_key" ON "journal_entries"("reversal_of_id");

-- CreateIndex
CREATE INDEX "journal_entries_entry_date_idx" ON "journal_entries"("entry_date");

-- CreateIndex
CREATE INDEX "journal_entries_status_idx" ON "journal_entries"("status");

-- CreateIndex
CREATE INDEX "journal_entries_source_type_source_id_idx" ON "journal_entries"("source_type", "source_id");

-- CreateIndex
CREATE INDEX "journal_lines_entry_id_idx" ON "journal_lines"("entry_id");

-- CreateIndex
CREATE INDEX "journal_lines_account_id_idx" ON "journal_lines"("account_id");

-- CreateIndex
CREATE INDEX "journal_lines_vessel_id_idx" ON "journal_lines"("vessel_id");

-- CreateIndex
CREATE INDEX "journal_lines_trip_id_idx" ON "journal_lines"("trip_id");

-- AddForeignKey
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_mappings" ADD CONSTRAINT "account_mappings_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_reversal_of_id_fkey" FOREIGN KEY ("reversal_of_id") REFERENCES "journal_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_entry_id_fkey" FOREIGN KEY ("entry_id") REFERENCES "journal_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_vessel_id_fkey" FOREIGN KEY ("vessel_id") REFERENCES "vessels"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_trip_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "fishing_trips"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- ===== custom integrity (hand-written) =====
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_one_side_chk"
  CHECK (debit >= 0 AND credit >= 0 AND ((debit > 0 AND credit = 0) OR (credit > 0 AND debit = 0)));
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_balanced_chk"
  CHECK (status IN ('DRAFT', 'VOID') OR (total_debit = total_credit AND total_debit > 0));
ALTER TABLE "fiscal_periods" ADD CONSTRAINT "fiscal_periods_month_chk" CHECK (month BETWEEN 1 AND 12 AND end_date >= start_date);
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_no_self_parent_chk" CHECK (parent_id IS NULL OR parent_id <> id);

-- one journal entry per source document event (idempotent automatic posting)
CREATE UNIQUE INDEX "journal_entries_source_key" ON "journal_entries" ("source_type", "source_id", "source_event") WHERE "source_type" IS NOT NULL;

-- entries are created as DRAFT; posting checks balance + open period; posted entries are immutable
CREATE OR REPLACE FUNCTION fisher_je_guard() RETURNS trigger AS $$
DECLARE dr numeric; cr numeric; n int; closed boolean;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'journal entries cannot be deleted (void or reverse instead)';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'DRAFT' THEN RAISE EXCEPTION 'journal entries must be created as DRAFT'; END IF;
    RETURN NEW;
  END IF;
  IF OLD.status IN ('REVERSED', 'VOID') THEN
    RAISE EXCEPTION 'journal entry % is %, it cannot change', OLD.entry_no, OLD.status;
  END IF;
  IF OLD.status = 'POSTED' THEN
    IF NEW.status <> 'REVERSED' OR NEW.entry_no <> OLD.entry_no OR NEW.entry_date <> OLD.entry_date
       OR NEW.total_debit <> OLD.total_debit OR NEW.total_credit <> OLD.total_credit OR NEW.memo <> OLD.memo
       OR NEW.source_type IS DISTINCT FROM OLD.source_type OR NEW.source_id IS DISTINCT FROM OLD.source_id
       OR NEW.source_event IS DISTINCT FROM OLD.source_event THEN
      RAISE EXCEPTION 'posted journal entry % is immutable', OLD.entry_no;
    END IF;
    RETURN NEW;
  END IF;
  -- DRAFT -> POSTED
  IF NEW.status = 'POSTED' THEN
    SELECT COALESCE(SUM(debit), 0), COALESCE(SUM(credit), 0), COUNT(*) INTO dr, cr, n FROM journal_lines WHERE entry_id = NEW.id;
    IF n < 2 OR dr <> cr OR dr <= 0 OR dr <> NEW.total_debit OR cr <> NEW.total_credit THEN
      RAISE EXCEPTION 'journal entry % is not balanced (dr %, cr %, lines %)', NEW.entry_no, dr, cr, n;
    END IF;
    SELECT status = 'CLOSED' INTO closed FROM fiscal_periods
      WHERE year = EXTRACT(YEAR FROM NEW.entry_date) AND month = EXTRACT(MONTH FROM NEW.entry_date);
    IF closed THEN RAISE EXCEPTION 'fiscal period of % is closed', NEW.entry_date; END IF;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER journal_entries_guard BEFORE INSERT OR UPDATE OR DELETE ON "journal_entries" FOR EACH ROW EXECUTE FUNCTION fisher_je_guard();

CREATE OR REPLACE FUNCTION fisher_jl_guard() RETURNS trigger AS $$
DECLARE st text;
BEGIN
  SELECT status INTO st FROM journal_entries WHERE id = COALESCE(NEW.entry_id, OLD.entry_id);
  IF st IS DISTINCT FROM 'DRAFT' THEN
    RAISE EXCEPTION 'lines of a % journal entry cannot change', st;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.entry_id <> OLD.entry_id THEN RAISE EXCEPTION 'cannot move journal lines'; END IF;
  RETURN COALESCE(NEW, OLD);
END $$ LANGUAGE plpgsql;
CREATE TRIGGER journal_lines_guard BEFORE INSERT OR UPDATE OR DELETE ON "journal_lines" FOR EACH ROW EXECUTE FUNCTION fisher_jl_guard();
