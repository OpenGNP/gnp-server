-- Current sql file was generated after introspecting the database
-- If you want to run this migration please uncomment this code before executing migrations
/*
CREATE TABLE "organizations" (
	"id" serial NOT NULL,
	"organization_name" varchar(255),
	"organization_domain" varchar(255),
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP,
	"updated_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial NOT NULL,
	"full_name" varchar(255),
	"email" varchar(255) NOT NULL,
	"password" varchar(255),
	"role" varchar(50),
	"organization_id" integer,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP,
	"updated_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "chk_role" CHECK ((role)::text = ANY ((ARRAY['user'::character varying, 'staff'::character varying, 'admin'::character varying, 'superadmin'::character varying])::text[]))
);
--> statement-breakpoint
CREATE TABLE "submissions" (
	"id" serial NOT NULL,
	"form_id" integer NOT NULL,
	"user_id" integer,
	"anonymous_code" varchar(100),
	"respondent_name" varchar(255),
	"submission_status" varchar(30) DEFAULT 'submitted',
	"ai_attempts" integer DEFAULT 0 NOT NULL,
	"ai_error" text,
	"processing_started_at" timestamp,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP,
	"updated_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "chk_submission_status" CHECK ((submission_status)::text = ANY ((ARRAY['submitted'::character varying, 'processing'::character varying, 'completed'::character varying, 'failed'::character varying])::text[]))
);
--> statement-breakpoint
CREATE TABLE "answers" (
	"id" serial NOT NULL,
	"submission_id" integer NOT NULL,
	"field_id" integer NOT NULL,
	"answer_text" text,
	"answer_option_id" integer,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP,
	"updated_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "points" (
	"id" serial NOT NULL,
	"answer_id" integer NOT NULL,
	"canonical_topic_id" integer,
	"point_text" text,
	"embedding" vector(384),
	"sentiment_label" varchar(20),
	"is_severe" boolean DEFAULT false,
	"assignment_confidence" real,
	"processing_status" varchar(30),
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP,
	"updated_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "chk_sentiment" CHECK ((sentiment_label)::text = ANY ((ARRAY['positive'::character varying, 'neutral'::character varying, 'negative'::character varying])::text[])),
	CONSTRAINT "chk_processing" CHECK ((processing_status)::text = ANY ((ARRAY['pending'::character varying, 'assigned'::character varying, 'unknown'::character varying, 'clustered'::character varying])::text[]))
);
--> statement-breakpoint
CREATE TABLE "folders" (
	"id" serial NOT NULL,
	"admin_id" integer NOT NULL,
	"parent_folder_id" integer,
	"folder_name" varchar(255),
	"folder_description" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP,
	"updated_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_model_runs" (
	"id" serial NOT NULL,
	"form_id" integer,
	"model_name" varchar(100),
	"model_version" varchar(100),
	"embedding_model" varchar(100),
	"clustering_algorithm" varchar(100),
	"parameters" text,
	"status" varchar(20),
	"error" text,
	"started_at" timestamp,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP,
	"updated_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "form_fields" (
	"id" serial NOT NULL,
	"form_id" integer NOT NULL,
	"field_label" varchar(255),
	"field_type" varchar(30),
	"section" varchar(20) DEFAULT 'feedback' NOT NULL,
	"analyze_with_ai" boolean DEFAULT false NOT NULL,
	"allow_other" boolean DEFAULT false NOT NULL,
	"is_required" boolean DEFAULT false,
	"field_order" integer,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP,
	"updated_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "chk_field_type" CHECK ((field_type)::text = ANY ((ARRAY['text'::character varying, 'textarea'::character varying, 'checkbox'::character varying, 'radio'::character varying])::text[])),
	CONSTRAINT "chk_field_section" CHECK ((section)::text = ANY ((ARRAY['demographic'::character varying, 'feedback'::character varying])::text[]))
);
--> statement-breakpoint
CREATE TABLE "forms" (
	"id" serial NOT NULL,
	"admin_id" integer NOT NULL,
	"folder_id" integer,
	"organization_id" integer,
	"form_title" varchar(255),
	"form_description" text,
	"cover_image_url" text,
	"status" varchar(20) DEFAULT 'draft' NOT NULL,
	"accepting_responses" boolean DEFAULT true NOT NULL,
	"published_at" timestamp,
	"public_token" uuid DEFAULT gen_random_uuid() NOT NULL,
	"slug" varchar(255),
	"access_type" varchar(30) DEFAULT 'organization' NOT NULL,
	"record_name" boolean DEFAULT false,
	"one_response_per_person" boolean DEFAULT false,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"start_date" timestamp,
	"end_date" timestamp,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP,
	"updated_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "chk_form_status" CHECK ((status)::text = ANY ((ARRAY['draft'::character varying, 'active'::character varying, 'closed'::character varying, 'archived'::character varying])::text[])),
	CONSTRAINT "chk_access_type" CHECK ((access_type)::text = ANY ((ARRAY['public'::character varying, 'organization'::character varying, 'specific'::character varying])::text[]))
);
--> statement-breakpoint
CREATE TABLE "form_allowed_users" (
	"id" serial NOT NULL,
	"form_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP,
	"updated_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "field_options" (
	"id" serial NOT NULL,
	"field_id" integer NOT NULL,
	"option_label" varchar(255),
	"option_value" varchar(255),
	"option_order" integer,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP,
	"updated_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "canonical_topics" (
	"id" serial NOT NULL,
	"form_id" integer,
	"field_id" integer,
	"merged_into_id" integer,
	"canonical_name" varchar(255),
	"canonical_summary" text,
	"representative_keywords" text,
	"centroid_vector" vector(384),
	"topic_size" integer,
	"status" varchar(20),
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP,
	"updated_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "chk_topic_status" CHECK ((status)::text = ANY ((ARRAY['active'::character varying, 'merged'::character varying, 'archived'::character varying])::text[]))
);
--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "fk_user_organization" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "fk_submission_form" FOREIGN KEY ("form_id") REFERENCES "public"."forms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "fk_submission_user" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "answers" ADD CONSTRAINT "fk_answer_submission" FOREIGN KEY ("submission_id") REFERENCES "public"."submissions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "answers" ADD CONSTRAINT "fk_answer_field" FOREIGN KEY ("field_id") REFERENCES "public"."form_fields"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "answers" ADD CONSTRAINT "fk_answer_option" FOREIGN KEY ("answer_option_id") REFERENCES "public"."field_options"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "points" ADD CONSTRAINT "fk_point_answer" FOREIGN KEY ("answer_id") REFERENCES "public"."answers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "points" ADD CONSTRAINT "fk_point_topic" FOREIGN KEY ("canonical_topic_id") REFERENCES "public"."canonical_topics"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "folders" ADD CONSTRAINT "fk_folder_admin" FOREIGN KEY ("admin_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "folders" ADD CONSTRAINT "fk_folder_parent" FOREIGN KEY ("parent_folder_id") REFERENCES "public"."folders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_model_runs" ADD CONSTRAINT "fk_model_run_form" FOREIGN KEY ("form_id") REFERENCES "public"."forms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_fields" ADD CONSTRAINT "fk_field_form" FOREIGN KEY ("form_id") REFERENCES "public"."forms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forms" ADD CONSTRAINT "fk_form_admin" FOREIGN KEY ("admin_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forms" ADD CONSTRAINT "fk_form_folder" FOREIGN KEY ("folder_id") REFERENCES "public"."folders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forms" ADD CONSTRAINT "fk_form_organization" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_allowed_users" ADD CONSTRAINT "fk_allowed_form" FOREIGN KEY ("form_id") REFERENCES "public"."forms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_allowed_users" ADD CONSTRAINT "fk_allowed_user" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "field_options" ADD CONSTRAINT "fk_option_field" FOREIGN KEY ("field_id") REFERENCES "public"."form_fields"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "canonical_topics" ADD CONSTRAINT "fk_topic_form" FOREIGN KEY ("form_id") REFERENCES "public"."forms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "canonical_topics" ADD CONSTRAINT "fk_topic_field" FOREIGN KEY ("field_id") REFERENCES "public"."form_fields"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "canonical_topics" ADD CONSTRAINT "fk_topic_merged_into" FOREIGN KEY ("merged_into_id") REFERENCES "public"."canonical_topics"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_users_organization_id" ON "users" USING btree ("organization_id" int4_ops);--> statement-breakpoint
CREATE INDEX "idx_submissions_ai_queue" ON "submissions" USING btree ("created_at" timestamp_ops) WHERE ((submission_status)::text = ANY ((ARRAY['submitted'::character varying, 'processing'::character varying])::text[]));--> statement-breakpoint
CREATE INDEX "idx_submissions_form_id" ON "submissions" USING btree ("form_id" int4_ops);--> statement-breakpoint
CREATE INDEX "idx_submissions_user_id" ON "submissions" USING btree ("user_id" int4_ops);--> statement-breakpoint
CREATE INDEX "idx_answers_answer_option_id" ON "answers" USING btree ("answer_option_id" int4_ops);--> statement-breakpoint
CREATE INDEX "idx_answers_field_id" ON "answers" USING btree ("field_id" int4_ops);--> statement-breakpoint
CREATE INDEX "idx_answers_submission_id" ON "answers" USING btree ("submission_id" int4_ops);--> statement-breakpoint
CREATE INDEX "idx_points_answer_id" ON "points" USING btree ("answer_id" int4_ops);--> statement-breakpoint
CREATE INDEX "idx_points_canonical_topic_id" ON "points" USING btree ("canonical_topic_id" int4_ops);--> statement-breakpoint
CREATE INDEX "idx_points_embedding_hnsw" ON "points" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX "idx_points_processing_status" ON "points" USING btree ("processing_status" text_ops);--> statement-breakpoint
CREATE INDEX "idx_folders_admin_id" ON "folders" USING btree ("admin_id" int4_ops);--> statement-breakpoint
CREATE INDEX "idx_folders_parent_folder_id" ON "folders" USING btree ("parent_folder_id" int4_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "uq_folder_sibling_name" ON "folders" USING btree (admin_id text_ops,COALESCE(parent_folder_id, 0) int4_ops,lower((folder_name)::text) int4_ops);--> statement-breakpoint
CREATE INDEX "idx_form_fields_form_id" ON "form_fields" USING btree ("form_id" int4_ops);--> statement-breakpoint
CREATE INDEX "idx_forms_admin_id" ON "forms" USING btree ("admin_id" int4_ops);--> statement-breakpoint
CREATE INDEX "idx_forms_folder_id" ON "forms" USING btree ("folder_id" int4_ops);--> statement-breakpoint
CREATE INDEX "idx_forms_organization_id" ON "forms" USING btree ("organization_id" int4_ops);--> statement-breakpoint
CREATE INDEX "idx_forms_status" ON "forms" USING btree ("status" text_ops);--> statement-breakpoint
CREATE INDEX "idx_form_allowed_users_user_id" ON "form_allowed_users" USING btree ("user_id" int4_ops);--> statement-breakpoint
CREATE INDEX "idx_field_options_field_id" ON "field_options" USING btree ("field_id" int4_ops);--> statement-breakpoint
CREATE INDEX "idx_canonical_topics_centroid_hnsw" ON "canonical_topics" USING hnsw ("centroid_vector" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX "idx_canonical_topics_form_status" ON "canonical_topics" USING btree ("form_id" int4_ops,"status" int4_ops);
*/