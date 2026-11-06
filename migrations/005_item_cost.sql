-- 005_item_cost.sql — an Important item can carry a cost (cents). With a date
-- it is planned spending: it comes out of the check that covers that day.

ALTER TABLE list_items ADD COLUMN cost INTEGER;
