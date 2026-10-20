CREATE TABLE "entities" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"resource_type" text NOT NULL,
	"resource_key" text NOT NULL,
	"data" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mock_rules" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"method" text NOT NULL,
	"path" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"latency_ms" integer,
	"error_rate" double precision,
	"error_status" integer,
	"error_body" jsonb,
	"status_override" integer,
	"body_static" jsonb,
	"body_patch" jsonb,
	"field_overrides" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"seed" integer,
	"validation_mode" text,
	"note" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"description" text,
	"config" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "projects_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "request_logs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"method" text NOT NULL,
	"path" text NOT NULL,
	"query" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"headers" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"request_body" jsonb,
	"status" integer NOT NULL,
	"response_body" jsonb,
	"latency_ms" integer NOT NULL,
	"matched_route_id" uuid,
	"error" text,
	"seed" integer,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "routes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"spec_id" uuid NOT NULL,
	"method" text NOT NULL,
	"path" text NOT NULL,
	"operation_id" text,
	"summary" text,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"request_schema" jsonb NOT NULL,
	"response_schema" jsonb NOT NULL,
	"success_status" integer DEFAULT 200 NOT NULL,
	"is_streaming" boolean DEFAULT false NOT NULL,
	"stream_kind" text,
	"crud" jsonb,
	"schema_hash" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "specs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"source_type" text NOT NULL,
	"source_uri" text NOT NULL,
	"content" jsonb NOT NULL,
	"openapi_version" text NOT NULL,
	"checksum" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"parse_error" text,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "entities" ADD CONSTRAINT "entities_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mock_rules" ADD CONSTRAINT "mock_rules_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_logs" ADD CONSTRAINT "request_logs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "routes" ADD CONSTRAINT "routes_spec_id_specs_id_fk" FOREIGN KEY ("spec_id") REFERENCES "public"."specs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "specs" ADD CONSTRAINT "specs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "entities_project_type_key_idx" ON "entities" USING btree ("project_id","resource_type","resource_key");--> statement-breakpoint
CREATE INDEX "entities_project_type_idx" ON "entities" USING btree ("project_id","resource_type");--> statement-breakpoint
CREATE UNIQUE INDEX "mock_rules_project_method_path_idx" ON "mock_rules" USING btree ("project_id","method","path");--> statement-breakpoint
CREATE INDEX "mock_rules_project_idx" ON "mock_rules" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "request_logs_project_created_idx" ON "request_logs" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "routes_spec_method_path_idx" ON "routes" USING btree ("spec_id","method","path");--> statement-breakpoint
CREATE INDEX "routes_spec_idx" ON "routes" USING btree ("spec_id");--> statement-breakpoint
CREATE INDEX "specs_project_idx" ON "specs" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "specs_checksum_idx" ON "specs" USING btree ("project_id","checksum");