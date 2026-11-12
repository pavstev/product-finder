-- Trigram matching for substring search (ILIKE %term%) on name, SKU, chemistry, etc.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- CreateEnum
CREATE TYPE "ProductStatus" AS ENUM ('ACTIVE', 'PHASE_OUT', 'DISCONTINUED');

-- CreateEnum
CREATE TYPE "ImportRunStatus" AS ENUM ('RUNNING', 'SUCCEEDED', 'FAILED', 'ABORTED');

-- CreateTable
CREATE TABLE "product" (
    "id" UUID NOT NULL,
    "sku" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "chemical_name" TEXT,
    "function" TEXT NOT NULL,
    "application_area" TEXT NOT NULL,
    "region" TEXT NOT NULL,
    "certifications" TEXT[],
    "status" "ProductStatus" NOT NULL,
    "launch_year" INTEGER,
    "description" TEXT,
    "search_text" TEXT NOT NULL,
    "source_hash" TEXT NOT NULL,
    "in_latest_export" BOOLEAN NOT NULL DEFAULT true,
    "review_count" INTEGER NOT NULL DEFAULT 0,
    "rating_sum" INTEGER NOT NULL DEFAULT 0,
    "rating_avg" DOUBLE PRECISION,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "review" (
    "id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "rating" SMALLINT NOT NULL,
    "title" VARCHAR(120),
    "body" VARCHAR(2000) NOT NULL,
    "author_name" VARCHAR(60) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "review_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_run" (
    "id" UUID NOT NULL,
    "source" TEXT NOT NULL,
    "status" "ImportRunStatus" NOT NULL DEFAULT 'RUNNING',
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),
    "rows_read" INTEGER NOT NULL DEFAULT 0,
    "created" INTEGER NOT NULL DEFAULT 0,
    "updated" INTEGER NOT NULL DEFAULT 0,
    "unchanged" INTEGER NOT NULL DEFAULT 0,
    "rejected" INTEGER NOT NULL DEFAULT 0,
    "duplicates" INTEGER NOT NULL DEFAULT 0,
    "marked_missing" INTEGER NOT NULL DEFAULT 0,
    "issues" JSONB NOT NULL DEFAULT '[]',
    "error" TEXT,

    CONSTRAINT "import_run_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "product_sku_key" ON "product"("sku");

-- CreateIndex
CREATE INDEX "product_in_latest_export_status_idx" ON "product"("in_latest_export", "status");

-- CreateIndex
CREATE INDEX "product_function_idx" ON "product"("function");

-- CreateIndex
CREATE INDEX "product_application_area_idx" ON "product"("application_area");

-- CreateIndex
CREATE INDEX "product_region_idx" ON "product"("region");

-- CreateIndex
CREATE INDEX "product_name_idx" ON "product"("name");

-- CreateIndex
CREATE INDEX "product_launch_year_idx" ON "product"("launch_year");

-- CreateIndex
CREATE INDEX "product_rating_avg_idx" ON "product"("rating_avg");

-- CreateIndex
CREATE INDEX "review_product_id_created_at_idx" ON "review"("product_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "import_run_status_finished_at_idx" ON "import_run"("status", "finished_at" DESC);

-- AddForeignKey
ALTER TABLE "review" ADD CONSTRAINT "review_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Hand-written: Prisma cannot express these in the schema.
CREATE INDEX "product_search_text_trgm_idx" ON "product" USING GIN ("search_text" gin_trgm_ops);
CREATE INDEX "product_certifications_idx" ON "product" USING GIN ("certifications");
ALTER TABLE "review" ADD CONSTRAINT "review_rating_range" CHECK ("rating" BETWEEN 1 AND 5);
ALTER TABLE "product" ADD CONSTRAINT "product_review_aggregates_valid" CHECK ("review_count" >= 0 AND "rating_sum" >= 0);
