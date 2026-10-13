CREATE INDEX "inbox_item_user_status_updated" ON "inbox_item" USING btree ("user_id","status","updated_at");
