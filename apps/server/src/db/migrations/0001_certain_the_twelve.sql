DROP INDEX "specs_checksum_idx";--> statement-breakpoint
CREATE INDEX "specs_checksum_idx" ON "specs" USING btree ("project_id","checksum");