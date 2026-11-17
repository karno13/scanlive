-- Delivery price (grosze) read with the language: a foreign edition with free delivery is accepted,
-- and that exception must hold on a cached read too, not only on the first one.
ALTER TABLE vinted_detail_cache ADD COLUMN shipping_cost INTEGER CHECK (shipping_cost IS NULL OR shipping_cost >= 0);
