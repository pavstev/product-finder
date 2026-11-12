-- The indexes the 50k query plans asked for.

-- Facet values (GET /api/products/facets). Each facet reads the listed products with an
-- index-only scan of this index, not with a sequential scan of the table.
-- CreateIndex
CREATE INDEX "product_facets_idx" ON "product"("in_latest_export", "status", "function", "application_area", "region", "certifications");

-- Hand-written: the -rating sort orders by rating_avg DESC NULLS LAST, then sku. Prisma would write
-- DESC alone, which puts NULLS FIRST, so the planner could not use it for that sort.
-- schema.prisma declares the columns and DESC. The drift check does not compare the NULLS order.
CREATE INDEX "product_rating_avg_desc_sku_idx" ON "product"("rating_avg" DESC NULLS LAST, "sku");
