-- CreateEnum
CREATE TYPE "VesselStatus" AS ENUM ('AT_PORT', 'AT_SEA', 'MAINTENANCE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "VesselDocType" AS ENUM ('REGISTRATION', 'FISHING_LICENSE', 'PORT_IN_OUT', 'INSURANCE', 'SAFETY_CERT', 'RADIO_LICENSE', 'OTHER');

-- CreateEnum
CREATE TYPE "EmployeeStatus" AS ENUM ('ACTIVE', 'ON_LEAVE', 'SUSPENDED', 'RESIGNED', 'TERMINATED');

-- CreateEnum
CREATE TYPE "EmployeePosition" AS ENUM ('CAPTAIN', 'ENGINEER', 'DECKHAND', 'COOK', 'FISH_HANDLER', 'OFFICE', 'MANAGER', 'OTHER');

-- CreateEnum
CREATE TYPE "Gender" AS ENUM ('MALE', 'FEMALE', 'OTHER', 'UNSPECIFIED');

-- CreateEnum
CREATE TYPE "PayType" AS ENUM ('MONTHLY', 'DAILY', 'PER_TRIP', 'REVENUE_SHARE', 'CATCH_BASED');

-- CreateEnum
CREATE TYPE "DocAppliesTo" AS ENUM ('ALL', 'THAI', 'FOREIGN');

-- CreateEnum
CREATE TYPE "EmpDocStatus" AS ENUM ('ACTIVE', 'REPLACED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TripStatus" AS ENUM ('DRAFT', 'PREPARING', 'DEPARTED', 'AT_SEA', 'RETURNING', 'ARRIVED', 'PENDING_SETTLEMENT', 'CLOSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "FuelType" AS ENUM ('DIESEL', 'DIESEL_B7', 'DIESEL_B10', 'BENZINE', 'OTHER');

-- CreateEnum
CREATE TYPE "Measurement" AS ENUM ('MEASURED', 'ESTIMATED');

-- CreateEnum
CREATE TYPE "SupplyCategory" AS ENUM ('FOOD', 'WATER', 'ICE', 'NET', 'ROPE', 'FISHING_GEAR', 'SPARE_PART', 'SAFETY', 'MAINTENANCE', 'OTHER');

-- CreateEnum
CREATE TYPE "TripExpenseCategory" AS ENUM ('PORT_FEE', 'ICE', 'FOOD', 'REPAIR', 'LABOR', 'UNLOADING', 'OTHER');

-- CreateEnum
CREATE TYPE "IncidentType" AS ENUM ('ACCIDENT', 'INJURY', 'EQUIPMENT_FAILURE', 'WEATHER', 'LOST_GEAR', 'INSPECTION', 'OTHER');

-- CreateEnum
CREATE TYPE "Severity" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- CreateEnum
CREATE TYPE "SpeciesCategory" AS ENUM ('FISH', 'SQUID', 'SHRIMP', 'CRAB', 'SHELLFISH', 'TRASH_FISH', 'OTHER');

-- CreateEnum
CREATE TYPE "StorageType" AS ENUM ('ICE', 'CHILLED', 'FROZEN', 'LIVE', 'DRIED', 'OTHER');

-- CreateEnum
CREATE TYPE "CatchQuality" AS ENUM ('EXCELLENT', 'GOOD', 'FAIR', 'POOR');

-- CreateEnum
CREATE TYPE "LossType" AS ENUM ('SPOILAGE', 'DAMAGE', 'WEIGH_DIFF', 'OTHER');

-- CreateEnum
CREATE TYPE "GpsSource" AS ENUM ('DEDICATED', 'MOBILE', 'AIS');

-- CreateEnum
CREATE TYPE "NotificationSeverity" AS ENUM ('INFO', 'WARNING', 'CRITICAL');

-- CreateEnum
CREATE TYPE "FileSensitivity" AS ENUM ('INTERNAL', 'CONFIDENTIAL', 'PERSONAL');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "username" TEXT NOT NULL,
    "email" TEXT,
    "password_hash" TEXT NOT NULL,
    "full_name" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "must_change_password" BOOLEAN NOT NULL DEFAULT false,
    "failed_logins" INTEGER NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMPTZ,
    "last_login_at" TIMESTAMPTZ,
    "employee_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roles" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "permissions" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "description" TEXT NOT NULL,

    CONSTRAINT "permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role_permissions" (
    "role_id" UUID NOT NULL,
    "permission_id" UUID NOT NULL,

    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("role_id","permission_id")
);

-- CreateTable
CREATE TABLE "user_roles" (
    "user_id" UUID NOT NULL,
    "role_id" UUID NOT NULL,

    CONSTRAINT "user_roles_pkey" PRIMARY KEY ("user_id","role_id")
);

-- CreateTable
CREATE TABLE "user_vessels" (
    "user_id" UUID NOT NULL,
    "vessel_id" UUID NOT NULL,

    CONSTRAINT "user_vessels_pkey" PRIMARY KEY ("user_id","vessel_id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" TEXT NOT NULL,
    "user_id" UUID NOT NULL,
    "csrf_token" TEXT NOT NULL,
    "ip" TEXT,
    "user_agent" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "files" (
    "id" UUID NOT NULL,
    "storage_key" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "sensitivity" "FileSensitivity" NOT NULL DEFAULT 'INTERNAL',
    "uploaded_by_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vessels" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "registration_no" TEXT NOT NULL,
    "vessel_type" TEXT NOT NULL,
    "length_m" DECIMAL(8,2),
    "width_m" DECIMAL(8,2),
    "gross_tonnage" DECIMAL(10,2),
    "net_tonnage" DECIMAL(10,2),
    "hull_material" TEXT,
    "build_year" INTEGER,
    "home_port" TEXT,
    "engine_make" TEXT,
    "engine_model" TEXT,
    "engine_serial_no" TEXT,
    "engine_power_hp" DECIMAL(10,2),
    "fuel_tank_capacity_l" DECIMAL(12,2),
    "owner_name" TEXT,
    "owner_tax_id" TEXT,
    "captain_id" UUID,
    "radio_call_sign" TEXT,
    "mmsi" TEXT,
    "comm_equipment" TEXT,
    "license_no" TEXT,
    "license_expiry" DATE,
    "registration_expiry" DATE,
    "status" "VesselStatus" NOT NULL DEFAULT 'AT_PORT',
    "photo_file_id" UUID,
    "notes" TEXT,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "vessels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vessel_documents" (
    "id" UUID NOT NULL,
    "vessel_id" UUID NOT NULL,
    "doc_type" "VesselDocType" NOT NULL,
    "doc_no" TEXT,
    "issue_date" DATE,
    "expiry_date" DATE,
    "file_id" UUID,
    "notes" TEXT,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "vessel_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employees" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "first_name" TEXT NOT NULL,
    "last_name" TEXT NOT NULL,
    "first_name_en" TEXT,
    "last_name_en" TEXT,
    "nickname" TEXT,
    "date_of_birth" DATE,
    "nationality" TEXT NOT NULL,
    "gender" "Gender" NOT NULL DEFAULT 'UNSPECIFIED',
    "phone" TEXT,
    "address" TEXT,
    "emergency_contact_name" TEXT,
    "emergency_contact_phone" TEXT,
    "national_id_no" TEXT,
    "start_date" DATE NOT NULL,
    "end_date" DATE,
    "status" "EmployeeStatus" NOT NULL DEFAULT 'ACTIVE',
    "position" "EmployeePosition" NOT NULL,
    "current_vessel_id" UUID,
    "pay_type" "PayType" NOT NULL DEFAULT 'MONTHLY',
    "base_rate" DECIMAL(14,2),
    "bank_name" TEXT,
    "bank_account_no" TEXT,
    "photo_file_id" UUID,
    "notes" TEXT,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "employees_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_types" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name_th" TEXT NOT NULL,
    "name_en" TEXT,
    "applies_to" "DocAppliesTo" NOT NULL DEFAULT 'ALL',
    "is_required" BOOLEAN NOT NULL DEFAULT false,
    "requires_expiry" BOOLEAN NOT NULL DEFAULT true,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "document_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employee_documents" (
    "id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "document_type_id" UUID NOT NULL,
    "document_no" TEXT,
    "issue_date" DATE,
    "expiry_date" DATE,
    "issued_by" TEXT,
    "file_id" UUID,
    "status" "EmpDocStatus" NOT NULL DEFAULT 'ACTIVE',
    "replaced_by_id" UUID,
    "notes" TEXT,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "employee_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employment_history" (
    "id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "event_type" TEXT NOT NULL,
    "effective_date" DATE NOT NULL,
    "from_value" TEXT,
    "to_value" TEXT,
    "notes" TEXT,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "employment_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vessel_assignments" (
    "id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "vessel_id" UUID NOT NULL,
    "position" "EmployeePosition" NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE,
    "notes" TEXT,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vessel_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fishing_trips" (
    "id" UUID NOT NULL,
    "trip_no" TEXT NOT NULL,
    "vessel_id" UUID NOT NULL,
    "captain_id" UUID,
    "status" "TripStatus" NOT NULL DEFAULT 'DRAFT',
    "planned_departure_at" TIMESTAMPTZ,
    "planned_return_at" TIMESTAMPTZ,
    "fishing_area" TEXT,
    "departed_at" TIMESTAMPTZ,
    "departure_port" TEXT,
    "departure_lat" DECIMAL(9,6),
    "departure_lng" DECIMAL(9,6),
    "fuel_at_departure_l" DECIMAL(12,2),
    "fuel_at_departure_measurement" "Measurement",
    "condition_note" TEXT,
    "departure_override_reason" TEXT,
    "arrived_at" TIMESTAMPTZ,
    "arrival_port" TEXT,
    "arrival_lat" DECIMAL(9,6),
    "arrival_lng" DECIMAL(9,6),
    "fuel_at_arrival_l" DECIMAL(12,2),
    "fuel_at_arrival_measurement" "Measurement",
    "allow_concurrent" BOOLEAN NOT NULL DEFAULT false,
    "concurrent_reason" TEXT,
    "settlement_snapshot" JSONB,
    "closed_at" TIMESTAMPTZ,
    "closed_by_id" UUID,
    "cancelled_at" TIMESTAMPTZ,
    "cancel_reason" TEXT,
    "notes" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "fishing_trips_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trip_status_history" (
    "id" UUID NOT NULL,
    "trip_id" UUID NOT NULL,
    "from_status" "TripStatus",
    "to_status" "TripStatus" NOT NULL,
    "note" TEXT,
    "changed_by_id" UUID,
    "changed_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trip_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trip_crew" (
    "id" UUID NOT NULL,
    "trip_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "role" "EmployeePosition" NOT NULL,
    "doc_check" JSONB,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trip_crew_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trip_fuel" (
    "id" UUID NOT NULL,
    "trip_id" UUID NOT NULL,
    "recorded_at" TIMESTAMPTZ NOT NULL,
    "fuel_type" "FuelType" NOT NULL,
    "liters" DECIMAL(12,2) NOT NULL,
    "price_per_liter" DECIMAL(10,4),
    "total_cost" DECIMAL(14,2),
    "supplier_name" TEXT,
    "measurement" "Measurement" NOT NULL DEFAULT 'MEASURED',
    "file_id" UUID,
    "notes" TEXT,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trip_fuel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trip_supplies" (
    "id" UUID NOT NULL,
    "trip_id" UUID NOT NULL,
    "category" "SupplyCategory" NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(12,3) NOT NULL,
    "unit" TEXT NOT NULL,
    "unit_cost" DECIMAL(14,4),
    "total_cost" DECIMAL(14,2),
    "notes" TEXT,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trip_supplies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trip_expenses" (
    "id" UUID NOT NULL,
    "trip_id" UUID NOT NULL,
    "category" "TripExpenseCategory" NOT NULL,
    "description" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "expense_date" DATE NOT NULL,
    "is_estimate" BOOLEAN NOT NULL DEFAULT false,
    "file_id" UUID,
    "notes" TEXT,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trip_expenses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trip_incidents" (
    "id" UUID NOT NULL,
    "trip_id" UUID NOT NULL,
    "occurred_at" TIMESTAMPTZ NOT NULL,
    "type" "IncidentType" NOT NULL,
    "severity" "Severity" NOT NULL,
    "description" TEXT NOT NULL,
    "lat" DECIMAL(9,6),
    "lng" DECIMAL(9,6),
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trip_incidents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fish_species" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name_th" TEXT NOT NULL,
    "name_en" TEXT,
    "scientific_name" TEXT,
    "category" "SpeciesCategory" NOT NULL,
    "unit" TEXT NOT NULL DEFAULT 'กก.',
    "default_price" DECIMAL(12,2),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "fish_species_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "catch_grades" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name_th" TEXT NOT NULL,
    "description" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "catch_grades_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "catch_records" (
    "id" UUID NOT NULL,
    "trip_id" UUID NOT NULL,
    "vessel_id" UUID NOT NULL,
    "species_id" UUID NOT NULL,
    "grade_id" UUID,
    "catch_date" DATE NOT NULL,
    "weight_kg" DECIMAL(12,3) NOT NULL,
    "quantity" INTEGER,
    "basket_count" INTEGER,
    "quality" "CatchQuality",
    "storage_type" "StorageType" NOT NULL DEFAULT 'ICE',
    "notes" TEXT,
    "client_request_id" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,
    "voided_at" TIMESTAMPTZ,
    "void_reason" TEXT,
    "voided_by_id" UUID,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "catch_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "catch_adjustments" (
    "id" UUID NOT NULL,
    "catch_record_id" UUID NOT NULL,
    "changes" JSONB NOT NULL,
    "reason" TEXT NOT NULL,
    "adjusted_by_id" UUID,
    "adjusted_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "catch_adjustments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "catch_losses" (
    "id" UUID NOT NULL,
    "trip_id" UUID NOT NULL,
    "catch_record_id" UUID,
    "species_id" UUID NOT NULL,
    "loss_type" "LossType" NOT NULL,
    "weight_kg" DECIMAL(12,3) NOT NULL,
    "reason" TEXT NOT NULL,
    "recorded_at" TIMESTAMPTZ NOT NULL,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "catch_losses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gps_devices" (
    "id" UUID NOT NULL,
    "vessel_id" UUID,
    "source" "GpsSource" NOT NULL,
    "identifier" TEXT NOT NULL,
    "name" TEXT,
    "api_key_hash" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "last_seen_at" TIMESTAMPTZ,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "gps_devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gps_positions" (
    "id" BIGSERIAL NOT NULL,
    "vessel_id" UUID NOT NULL,
    "device_id" UUID,
    "recorded_at" TIMESTAMPTZ NOT NULL,
    "received_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lat" DECIMAL(9,6) NOT NULL,
    "lng" DECIMAL(9,6) NOT NULL,
    "speed_knots" DECIMAL(6,2),
    "heading_deg" DECIMAL(5,2),
    "signal_quality" INTEGER,
    "source" "GpsSource" NOT NULL,
    "is_demo" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "gps_positions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "severity" "NotificationSeverity" NOT NULL DEFAULT 'INFO',
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "link" TEXT,
    "entity_type" TEXT,
    "entity_id" TEXT,
    "dedupe_key" TEXT NOT NULL,
    "read_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" BIGSERIAL NOT NULL,
    "at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "user_id" UUID,
    "username" TEXT,
    "action" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT,
    "before" JSONB,
    "after" JSONB,
    "note" TEXT,
    "ip" TEXT,
    "user_agent" TEXT,
    "request_id" TEXT,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app_settings" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updated_by_id" UUID,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "app_settings_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "doc_sequences" (
    "key" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "last_value" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "doc_sequences_pkey" PRIMARY KEY ("key","period")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_employee_id_key" ON "users"("employee_id");

-- CreateIndex
CREATE UNIQUE INDEX "roles_code_key" ON "roles"("code");

-- CreateIndex
CREATE UNIQUE INDEX "permissions_code_key" ON "permissions"("code");

-- CreateIndex
CREATE INDEX "user_roles_role_id_idx" ON "user_roles"("role_id");

-- CreateIndex
CREATE INDEX "sessions_user_id_idx" ON "sessions"("user_id");

-- CreateIndex
CREATE INDEX "sessions_expires_at_idx" ON "sessions"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "files_storage_key_key" ON "files"("storage_key");

-- CreateIndex
CREATE UNIQUE INDEX "vessels_code_key" ON "vessels"("code");

-- CreateIndex
CREATE UNIQUE INDEX "vessels_registration_no_key" ON "vessels"("registration_no");

-- CreateIndex
CREATE UNIQUE INDEX "vessels_mmsi_key" ON "vessels"("mmsi");

-- CreateIndex
CREATE INDEX "vessels_status_idx" ON "vessels"("status");

-- CreateIndex
CREATE INDEX "vessels_deleted_at_idx" ON "vessels"("deleted_at");

-- CreateIndex
CREATE INDEX "vessel_documents_vessel_id_idx" ON "vessel_documents"("vessel_id");

-- CreateIndex
CREATE INDEX "vessel_documents_expiry_date_idx" ON "vessel_documents"("expiry_date");

-- CreateIndex
CREATE UNIQUE INDEX "employees_code_key" ON "employees"("code");

-- CreateIndex
CREATE INDEX "employees_status_idx" ON "employees"("status");

-- CreateIndex
CREATE INDEX "employees_current_vessel_id_idx" ON "employees"("current_vessel_id");

-- CreateIndex
CREATE INDEX "employees_nationality_idx" ON "employees"("nationality");

-- CreateIndex
CREATE INDEX "employees_deleted_at_idx" ON "employees"("deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "document_types_code_key" ON "document_types"("code");

-- CreateIndex
CREATE UNIQUE INDEX "employee_documents_replaced_by_id_key" ON "employee_documents"("replaced_by_id");

-- CreateIndex
CREATE INDEX "employee_documents_employee_id_status_idx" ON "employee_documents"("employee_id", "status");

-- CreateIndex
CREATE INDEX "employee_documents_expiry_date_idx" ON "employee_documents"("expiry_date");

-- CreateIndex
CREATE INDEX "employment_history_employee_id_effective_date_idx" ON "employment_history"("employee_id", "effective_date");

-- CreateIndex
CREATE INDEX "vessel_assignments_employee_id_idx" ON "vessel_assignments"("employee_id");

-- CreateIndex
CREATE INDEX "vessel_assignments_vessel_id_end_date_idx" ON "vessel_assignments"("vessel_id", "end_date");

-- CreateIndex
CREATE UNIQUE INDEX "fishing_trips_trip_no_key" ON "fishing_trips"("trip_no");

-- CreateIndex
CREATE INDEX "fishing_trips_vessel_id_status_idx" ON "fishing_trips"("vessel_id", "status");

-- CreateIndex
CREATE INDEX "fishing_trips_status_idx" ON "fishing_trips"("status");

-- CreateIndex
CREATE INDEX "fishing_trips_departed_at_idx" ON "fishing_trips"("departed_at");

-- CreateIndex
CREATE INDEX "trip_status_history_trip_id_changed_at_idx" ON "trip_status_history"("trip_id", "changed_at");

-- CreateIndex
CREATE INDEX "trip_crew_employee_id_idx" ON "trip_crew"("employee_id");

-- CreateIndex
CREATE UNIQUE INDEX "trip_crew_trip_id_employee_id_key" ON "trip_crew"("trip_id", "employee_id");

-- CreateIndex
CREATE INDEX "trip_fuel_trip_id_idx" ON "trip_fuel"("trip_id");

-- CreateIndex
CREATE INDEX "trip_supplies_trip_id_idx" ON "trip_supplies"("trip_id");

-- CreateIndex
CREATE INDEX "trip_expenses_trip_id_idx" ON "trip_expenses"("trip_id");

-- CreateIndex
CREATE INDEX "trip_incidents_trip_id_idx" ON "trip_incidents"("trip_id");

-- CreateIndex
CREATE UNIQUE INDEX "fish_species_code_key" ON "fish_species"("code");

-- CreateIndex
CREATE UNIQUE INDEX "catch_grades_code_key" ON "catch_grades"("code");

-- CreateIndex
CREATE UNIQUE INDEX "catch_records_client_request_id_key" ON "catch_records"("client_request_id");

-- CreateIndex
CREATE INDEX "catch_records_trip_id_idx" ON "catch_records"("trip_id");

-- CreateIndex
CREATE INDEX "catch_records_vessel_id_catch_date_idx" ON "catch_records"("vessel_id", "catch_date");

-- CreateIndex
CREATE INDEX "catch_records_species_id_catch_date_idx" ON "catch_records"("species_id", "catch_date");

-- CreateIndex
CREATE INDEX "catch_records_catch_date_idx" ON "catch_records"("catch_date");

-- CreateIndex
CREATE INDEX "catch_adjustments_catch_record_id_idx" ON "catch_adjustments"("catch_record_id");

-- CreateIndex
CREATE INDEX "catch_losses_trip_id_idx" ON "catch_losses"("trip_id");

-- CreateIndex
CREATE UNIQUE INDEX "gps_devices_identifier_key" ON "gps_devices"("identifier");

-- CreateIndex
CREATE INDEX "gps_positions_vessel_id_recorded_at_idx" ON "gps_positions"("vessel_id", "recorded_at");

-- CreateIndex
CREATE UNIQUE INDEX "gps_positions_device_id_recorded_at_key" ON "gps_positions"("device_id", "recorded_at");

-- CreateIndex
CREATE INDEX "notifications_user_id_read_at_idx" ON "notifications"("user_id", "read_at");

-- CreateIndex
CREATE UNIQUE INDEX "notifications_user_id_dedupe_key_key" ON "notifications"("user_id", "dedupe_key");

-- CreateIndex
CREATE INDEX "audit_logs_entity_type_entity_id_idx" ON "audit_logs"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "audit_logs_user_id_at_idx" ON "audit_logs"("user_id", "at");

-- CreateIndex
CREATE INDEX "audit_logs_at_idx" ON "audit_logs"("at");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_id_fkey" FOREIGN KEY ("permission_id") REFERENCES "permissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_vessels" ADD CONSTRAINT "user_vessels_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_vessels" ADD CONSTRAINT "user_vessels_vessel_id_fkey" FOREIGN KEY ("vessel_id") REFERENCES "vessels"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vessels" ADD CONSTRAINT "vessels_captain_id_fkey" FOREIGN KEY ("captain_id") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vessel_documents" ADD CONSTRAINT "vessel_documents_vessel_id_fkey" FOREIGN KEY ("vessel_id") REFERENCES "vessels"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_current_vessel_id_fkey" FOREIGN KEY ("current_vessel_id") REFERENCES "vessels"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_documents" ADD CONSTRAINT "employee_documents_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_documents" ADD CONSTRAINT "employee_documents_document_type_id_fkey" FOREIGN KEY ("document_type_id") REFERENCES "document_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_documents" ADD CONSTRAINT "employee_documents_replaced_by_id_fkey" FOREIGN KEY ("replaced_by_id") REFERENCES "employee_documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employment_history" ADD CONSTRAINT "employment_history_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vessel_assignments" ADD CONSTRAINT "vessel_assignments_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vessel_assignments" ADD CONSTRAINT "vessel_assignments_vessel_id_fkey" FOREIGN KEY ("vessel_id") REFERENCES "vessels"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fishing_trips" ADD CONSTRAINT "fishing_trips_vessel_id_fkey" FOREIGN KEY ("vessel_id") REFERENCES "vessels"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fishing_trips" ADD CONSTRAINT "fishing_trips_captain_id_fkey" FOREIGN KEY ("captain_id") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trip_status_history" ADD CONSTRAINT "trip_status_history_trip_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "fishing_trips"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trip_crew" ADD CONSTRAINT "trip_crew_trip_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "fishing_trips"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trip_crew" ADD CONSTRAINT "trip_crew_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trip_fuel" ADD CONSTRAINT "trip_fuel_trip_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "fishing_trips"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trip_supplies" ADD CONSTRAINT "trip_supplies_trip_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "fishing_trips"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trip_expenses" ADD CONSTRAINT "trip_expenses_trip_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "fishing_trips"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trip_incidents" ADD CONSTRAINT "trip_incidents_trip_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "fishing_trips"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catch_records" ADD CONSTRAINT "catch_records_trip_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "fishing_trips"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catch_records" ADD CONSTRAINT "catch_records_vessel_id_fkey" FOREIGN KEY ("vessel_id") REFERENCES "vessels"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catch_records" ADD CONSTRAINT "catch_records_species_id_fkey" FOREIGN KEY ("species_id") REFERENCES "fish_species"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catch_records" ADD CONSTRAINT "catch_records_grade_id_fkey" FOREIGN KEY ("grade_id") REFERENCES "catch_grades"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catch_adjustments" ADD CONSTRAINT "catch_adjustments_catch_record_id_fkey" FOREIGN KEY ("catch_record_id") REFERENCES "catch_records"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catch_losses" ADD CONSTRAINT "catch_losses_trip_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "fishing_trips"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catch_losses" ADD CONSTRAINT "catch_losses_catch_record_id_fkey" FOREIGN KEY ("catch_record_id") REFERENCES "catch_records"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catch_losses" ADD CONSTRAINT "catch_losses_species_id_fkey" FOREIGN KEY ("species_id") REFERENCES "fish_species"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gps_devices" ADD CONSTRAINT "gps_devices_vessel_id_fkey" FOREIGN KEY ("vessel_id") REFERENCES "vessels"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gps_positions" ADD CONSTRAINT "gps_positions_vessel_id_fkey" FOREIGN KEY ("vessel_id") REFERENCES "vessels"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gps_positions" ADD CONSTRAINT "gps_positions_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "gps_devices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ===== Business-rule constraints not expressible in Prisma schema =====
-- Rule 2: one active trip per vessel unless explicitly authorised (allow_concurrent)
CREATE UNIQUE INDEX "fishing_trips_one_active_per_vessel"
  ON "fishing_trips" ("vessel_id")
  WHERE "status" IN ('PREPARING','DEPARTED','AT_SEA','RETURNING','ARRIVED') AND "allow_concurrent" = false;

-- One open vessel assignment per employee
CREATE UNIQUE INDEX "vessel_assignments_one_open_per_employee"
  ON "vessel_assignments" ("employee_id") WHERE "end_date" IS NULL;

-- Value sanity checks
ALTER TABLE "catch_records" ADD CONSTRAINT "catch_records_weight_positive" CHECK ("weight_kg" > 0);
ALTER TABLE "catch_losses" ADD CONSTRAINT "catch_losses_weight_positive" CHECK ("weight_kg" > 0);
ALTER TABLE "trip_fuel" ADD CONSTRAINT "trip_fuel_liters_positive" CHECK ("liters" > 0);
ALTER TABLE "trip_expenses" ADD CONSTRAINT "trip_expenses_amount_positive" CHECK ("amount" > 0);
ALTER TABLE "trip_supplies" ADD CONSTRAINT "trip_supplies_qty_positive" CHECK ("quantity" > 0);
ALTER TABLE "fishing_trips" ADD CONSTRAINT "fishing_trips_arrival_after_departure"
  CHECK ("arrived_at" IS NULL OR "departed_at" IS NULL OR "arrived_at" >= "departed_at");
ALTER TABLE "gps_positions" ADD CONSTRAINT "gps_positions_lat_range" CHECK ("lat" BETWEEN -90 AND 90);
ALTER TABLE "gps_positions" ADD CONSTRAINT "gps_positions_lng_range" CHECK ("lng" BETWEEN -180 AND 180);

-- Rule 10/11: audit log is append-only
CREATE OR REPLACE FUNCTION audit_logs_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs is append-only';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER audit_logs_no_update BEFORE UPDATE OR DELETE ON "audit_logs"
  FOR EACH ROW EXECUTE FUNCTION audit_logs_immutable();
