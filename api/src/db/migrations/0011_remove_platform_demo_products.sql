-- Removes the 44 seeded platform demo products inserted by 0002_chubby_scarlet_spider.
--
-- Every table that references products.id does so ON DELETE RESTRICT, so a bare DELETE
-- would fail mid-migration with a bare constraint error. This block instead counts the
-- referencing rows up front and aborts with an actionable message, leaving the catalog
-- untouched. Historical orders are never silently broken: order_items keeps its own
-- product_name, product_slug and unit_price_minor, but an order that still points at a
-- demo product blocks removal until that reference is dealt with deliberately.
DO $$
DECLARE
  demo_keys text[] := ARRAY[
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
  ];
  target_ids uuid[];
  reference record;
  blocking_total bigint := 0;
  blocking_detail text := '';
BEGIN
  SELECT coalesce(array_agg(id), '{}'::uuid[])
    INTO target_ids
    FROM products
   WHERE source = 'PLATFORM'
     AND catalog_key = ANY(demo_keys);

  IF cardinality(target_ids) = 0 THEN
    RAISE NOTICE 'No seeded platform demo products present; nothing to remove.';
    RETURN;
  END IF;

  FOR reference IN
      SELECT 'order_items' AS table_name, count(*) AS row_count
        FROM order_items WHERE product_id = ANY(target_ids)
    UNION ALL
      SELECT 'product_inventory', count(*)
        FROM product_inventory WHERE product_id = ANY(target_ids)
    UNION ALL
      SELECT 'product_media', count(*)
        FROM product_media WHERE product_id = ANY(target_ids)
    UNION ALL
      SELECT 'inventory_reservations', count(*)
        FROM inventory_reservations WHERE product_id = ANY(target_ids)
    UNION ALL
      SELECT 'inventory_events', count(*)
        FROM inventory_events WHERE product_id = ANY(target_ids)
    UNION ALL
      SELECT 'seller_product_activations', count(*)
        FROM seller_product_activations WHERE product_id = ANY(target_ids)
    UNION ALL
      SELECT 'staff_audit_events', count(*)
        FROM staff_audit_events WHERE product_id = ANY(target_ids)
  LOOP
    IF reference.row_count > 0 THEN
      blocking_total := blocking_total + reference.row_count;
      blocking_detail := blocking_detail || format('%s=%s ', reference.table_name, reference.row_count);
    END IF;
  END LOOP;

  IF blocking_total > 0 THEN
    RAISE EXCEPTION
      'Refusing to delete % seeded platform demo product(s): % referencing row(s) remain (%). No products were removed. Resolve or archive these references before re-running this migration.',
      cardinality(target_ids), blocking_total, trim(blocking_detail);
  END IF;

  DELETE FROM products WHERE id = ANY(target_ids);

  RAISE NOTICE 'Removed % seeded platform demo product(s).', cardinality(target_ids);
END $$;
