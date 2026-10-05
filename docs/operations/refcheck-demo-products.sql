-- READ ONLY. Counts exactly what 0011_remove_platform_demo_products.sql checks
-- before it will delete anything. Modifies nothing.
WITH demo_keys AS (
  SELECT unnest(ARRAY[
    'lp-01','lp-02','lp-03','lp-04',
    'sc-01','sc-02','sc-03','sc-04',
    'wf-01','wf-02','wf-03','wf-04',
    'ac-01','ac-02','ac-03','ac-04',
    'ph-01','ph-02','ph-03','ph-04',
    'hk-01','hk-02','hk-03','hk-04',
    'fa-01','fa-02','fa-03','fa-04',
    'bh-01','bh-02','bh-03','bh-04',
    'so-01','so-02','so-03','so-04',
    'gr-01','gr-02','gr-03','gr-04',
    'sp-01','sp-02','sp-03','sp-04'
  ]) AS catalog_key
),
targets AS (
  SELECT p.id
    FROM products p
    JOIN demo_keys d ON d.catalog_key = p.catalog_key
   WHERE p.source = 'PLATFORM'
)
SELECT 'products_matched'           AS table_name, count(*)::bigint AS rows FROM targets
UNION ALL SELECT 'order_items',               count(*) FROM order_items               WHERE product_id IN (SELECT id FROM targets)
UNION ALL SELECT 'product_inventory',         count(*) FROM product_inventory         WHERE product_id IN (SELECT id FROM targets)
UNION ALL SELECT 'product_media',             count(*) FROM product_media             WHERE product_id IN (SELECT id FROM targets)
UNION ALL SELECT 'inventory_reservations',    count(*) FROM inventory_reservations    WHERE product_id IN (SELECT id FROM targets)
UNION ALL SELECT 'inventory_events',          count(*) FROM inventory_events          WHERE product_id IN (SELECT id FROM targets)
UNION ALL SELECT 'seller_product_activations',count(*) FROM seller_product_activations WHERE product_id IN (SELECT id FROM targets)
UNION ALL SELECT 'staff_audit_events',        count(*) FROM staff_audit_events        WHERE product_id IN (SELECT id FROM targets)
ORDER BY 1;
