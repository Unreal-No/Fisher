-- CreateEnum
CREATE TYPE "GeofenceType" AS ENUM ('CIRCLE', 'POLYGON');

-- CreateEnum
CREATE TYPE "GeofenceAlert" AS ENUM ('ENTER', 'EXIT', 'BOTH');

-- CreateEnum
CREATE TYPE "FuelTxnType" AS ENUM ('RECEIPT', 'ISSUE', 'ADJUSTMENT');

-- DropIndex
DROP INDEX "gps_positions_device_id_recorded_at_key";

-- AlterTable
ALTER TABLE "fishing_trips" ADD COLUMN     "engine_hours_at_arrival" DECIMAL(10,1),
ADD COLUMN     "engine_hours_at_departure" DECIMAL(10,1);

-- CreateTable
CREATE TABLE "geofences" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "type" "GeofenceType" NOT NULL,
    "center_lat" DECIMAL(9,6),
    "center_lng" DECIMAL(9,6),
    "radius_km" DECIMAL(10,3),
    "polygon" JSONB,
    "alert_on" "GeofenceAlert" NOT NULL DEFAULT 'BOTH',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "geofences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "geofence_events" (
    "id" UUID NOT NULL,
    "geofence_id" UUID NOT NULL,
    "vessel_id" UUID NOT NULL,
    "event_type" TEXT NOT NULL,
    "at" TIMESTAMPTZ NOT NULL,
    "lat" DECIMAL(9,6) NOT NULL,
    "lng" DECIMAL(9,6) NOT NULL,
    "is_demo" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "geofence_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fuel_tanks" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "location" TEXT,
    "fuel_type" "FuelType" NOT NULL,
    "capacity_l" DECIMAL(14,2),
    "balance_l" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "avg_cost" DECIMAL(12,4) NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "fuel_tanks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fuel_transactions" (
    "id" UUID NOT NULL,
    "txn_no" TEXT NOT NULL,
    "tank_id" UUID NOT NULL,
    "type" "FuelTxnType" NOT NULL,
    "txn_date" TIMESTAMPTZ NOT NULL,
    "liters" DECIMAL(14,2) NOT NULL,
    "unit_cost" DECIMAL(12,4) NOT NULL,
    "total_cost" DECIMAL(14,2) NOT NULL,
    "balance_after_l" DECIMAL(14,2) NOT NULL,
    "avg_cost_after" DECIMAL(12,4) NOT NULL,
    "vessel_id" UUID,
    "trip_id" UUID,
    "trip_fuel_id" UUID,
    "supplier_name" TEXT,
    "doc_no" TEXT,
    "measurement" "Measurement",
    "override_reason" TEXT,
    "file_id" UUID,
    "notes" TEXT,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fuel_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "geofence_events_vessel_id_at_idx" ON "geofence_events"("vessel_id", "at");

-- CreateIndex
CREATE INDEX "geofence_events_geofence_id_at_idx" ON "geofence_events"("geofence_id", "at");

-- CreateIndex
CREATE UNIQUE INDEX "fuel_tanks_code_key" ON "fuel_tanks"("code");

-- CreateIndex
CREATE UNIQUE INDEX "fuel_transactions_txn_no_key" ON "fuel_transactions"("txn_no");

-- CreateIndex
CREATE UNIQUE INDEX "fuel_transactions_trip_fuel_id_key" ON "fuel_transactions"("trip_fuel_id");

-- CreateIndex
CREATE INDEX "fuel_transactions_tank_id_txn_date_idx" ON "fuel_transactions"("tank_id", "txn_date");

-- CreateIndex
CREATE INDEX "fuel_transactions_vessel_id_txn_date_idx" ON "fuel_transactions"("vessel_id", "txn_date");

-- CreateIndex
CREATE UNIQUE INDEX "gps_devices_api_key_hash_key" ON "gps_devices"("api_key_hash");

-- CreateIndex
CREATE UNIQUE INDEX "gps_positions_vessel_id_device_id_recorded_at_key" ON "gps_positions"("vessel_id", "device_id", "recorded_at");

-- AddForeignKey
ALTER TABLE "geofence_events" ADD CONSTRAINT "geofence_events_geofence_id_fkey" FOREIGN KEY ("geofence_id") REFERENCES "geofences"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "geofence_events" ADD CONSTRAINT "geofence_events_vessel_id_fkey" FOREIGN KEY ("vessel_id") REFERENCES "vessels"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fuel_transactions" ADD CONSTRAINT "fuel_transactions_tank_id_fkey" FOREIGN KEY ("tank_id") REFERENCES "fuel_tanks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fuel_transactions" ADD CONSTRAINT "fuel_transactions_vessel_id_fkey" FOREIGN KEY ("vessel_id") REFERENCES "vessels"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fuel_transactions" ADD CONSTRAINT "fuel_transactions_trip_fuel_id_fkey" FOREIGN KEY ("trip_fuel_id") REFERENCES "trip_fuel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ===== Business-rule constraints =====
ALTER TABLE "geofences" ADD CONSTRAINT "geofences_radius_positive" CHECK ("radius_km" IS NULL OR "radius_km" > 0);
ALTER TABLE "fuel_tanks" ADD CONSTRAINT "fuel_tanks_capacity_nonneg" CHECK ("capacity_l" IS NULL OR "capacity_l" >= 0);
ALTER TABLE "fuel_transactions" ADD CONSTRAINT "fuel_transactions_liters_nonzero" CHECK ("liters" <> 0);
ALTER TABLE "fishing_trips" ADD CONSTRAINT "fishing_trips_engine_hours_order"
  CHECK ("engine_hours_at_arrival" IS NULL OR "engine_hours_at_departure" IS NULL OR "engine_hours_at_arrival" >= "engine_hours_at_departure");

-- Fuel ledger is immutable: corrections must be ADJUSTMENT rows
CREATE OR REPLACE FUNCTION fuel_transactions_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'fuel_transactions is append-only';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER fuel_transactions_no_update BEFORE UPDATE OR DELETE ON "fuel_transactions"
  FOR EACH ROW EXECUTE FUNCTION fuel_transactions_immutable();
