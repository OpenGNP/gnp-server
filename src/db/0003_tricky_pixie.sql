ALTER TABLE "canonical_topics" DROP CONSTRAINT "chk_topic_status";--> statement-breakpoint
ALTER TABLE "points" DROP CONSTRAINT "chk_processing";--> statement-breakpoint
ALTER TABLE "canonical_topics" DROP CONSTRAINT "fk_topic_field";
--> statement-breakpoint
ALTER TABLE "canonical_topics" DROP CONSTRAINT "fk_topic_merged_into";
--> statement-breakpoint
DROP INDEX "idx_canonical_topics_centroid_hnsw";--> statement-breakpoint
DROP INDEX "idx_canonical_topics_form_status";--> statement-breakpoint
DROP INDEX "idx_folders_admin_id";--> statement-breakpoint
DROP INDEX "idx_forms_admin_id";--> statement-breakpoint
DROP INDEX "idx_forms_status";--> statement-breakpoint
DROP INDEX "idx_points_canonical_topic_id";--> statement-breakpoint
DROP INDEX "idx_points_embedding_hnsw";--> statement-breakpoint
DROP INDEX "idx_points_processing_status";--> statement-breakpoint
DROP INDEX "idx_submissions_ai_queue";--> statement-breakpoint
ALTER TABLE "ai_model_runs" ADD PRIMARY KEY ("id");--> statement-breakpoint
ALTER TABLE "ai_model_runs" ALTER COLUMN "form_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_model_runs" ALTER COLUMN "status" SET DEFAULT 'running';--> statement-breakpoint
ALTER TABLE "ai_model_runs" ALTER COLUMN "status" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "answers" ADD PRIMARY KEY ("id");--> statement-breakpoint
ALTER TABLE "canonical_topics" ADD PRIMARY KEY ("id");--> statement-breakpoint
ALTER TABLE "canonical_topics" ALTER COLUMN "form_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "field_options" ADD PRIMARY KEY ("id");--> statement-breakpoint
ALTER TABLE "folders" ADD PRIMARY KEY ("id");--> statement-breakpoint
ALTER TABLE "form_allowed_users" ADD PRIMARY KEY ("id");--> statement-breakpoint
ALTER TABLE "form_fields" ADD PRIMARY KEY ("id");--> statement-breakpoint
ALTER TABLE "forms" ADD PRIMARY KEY ("id");--> statement-breakpoint
ALTER TABLE "organizations" ADD PRIMARY KEY ("id");--> statement-breakpoint
ALTER TABLE "points" ADD PRIMARY KEY ("id");--> statement-breakpoint
ALTER TABLE "points" ALTER COLUMN "point_text" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "points" ALTER COLUMN "is_severe" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "points" ALTER COLUMN "processing_status" SET DATA TYPE varchar(20);--> statement-breakpoint
ALTER TABLE "points" ALTER COLUMN "processing_status" SET DEFAULT 'pending';--> statement-breakpoint
ALTER TABLE "points" ALTER COLUMN "processing_status" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "submissions" ADD PRIMARY KEY ("id");--> statement-breakpoint
ALTER TABLE "submissions" ALTER COLUMN "submission_status" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD PRIMARY KEY ("id");--> statement-breakpoint
ALTER TABLE "answers" ADD COLUMN "decomposed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "forms" ADD COLUMN "url_id" uuid DEFAULT gen_random_uuid() NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_ai_model_runs_form" ON "ai_model_runs" USING btree ("form_id" int4_ops,"started_at" int4_ops);--> statement-breakpoint
CREATE INDEX "idx_answers_to_decompose" ON "answers" USING btree ("id" int4_ops) WHERE ((decomposed_at IS NULL) AND (answer_text IS NOT NULL));--> statement-breakpoint
CREATE INDEX "idx_canonical_topics_form_id" ON "canonical_topics" USING btree ("form_id" int4_ops);--> statement-breakpoint
CREATE INDEX "idx_forms_admin_status" ON "forms" USING btree ("admin_id" int4_ops,"status" text_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "uq_forms_url_id" ON "forms" USING btree ("url_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_points_pending" ON "points" USING btree ("id" int4_ops) WHERE ((processing_status)::text = 'pending'::text);--> statement-breakpoint
CREATE INDEX "idx_points_topic" ON "points" USING btree ("canonical_topic_id" int4_ops) WHERE (canonical_topic_id IS NOT NULL);--> statement-breakpoint
ALTER TABLE "canonical_topics" DROP COLUMN "field_id";--> statement-breakpoint
ALTER TABLE "canonical_topics" DROP COLUMN "merged_into_id";--> statement-breakpoint
ALTER TABLE "canonical_topics" DROP COLUMN "status";--> statement-breakpoint
ALTER TABLE "submissions" DROP COLUMN "ai_attempts";--> statement-breakpoint
ALTER TABLE "submissions" DROP COLUMN "ai_error";--> statement-breakpoint
ALTER TABLE "submissions" DROP COLUMN "processing_started_at";--> statement-breakpoint
ALTER TABLE "form_allowed_users" ADD CONSTRAINT "form_allowed_users_form_id_email_key" UNIQUE("email","form_id");--> statement-breakpoint
ALTER TABLE "forms" ADD CONSTRAINT "uq_form_public_token" UNIQUE("public_token");--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_email_key" UNIQUE("email");--> statement-breakpoint
ALTER TABLE "ai_model_runs" ADD CONSTRAINT "chk_run_status" CHECK ((status)::text = ANY ((ARRAY['running'::character varying, 'completed'::character varying, 'failed'::character varying])::text[]));--> statement-breakpoint
ALTER TABLE "points" ADD CONSTRAINT "chk_status_topic" CHECK (((processing_status)::text = 'assigned'::text) = (canonical_topic_id IS NOT NULL));--> statement-breakpoint
ALTER TABLE "points" ADD CONSTRAINT "chk_labels_together" CHECK ((sentiment_label IS NULL) = (is_severe IS NULL));--> statement-breakpoint
ALTER TABLE "points" ADD CONSTRAINT "chk_processing" CHECK ((processing_status)::text = ANY (ARRAY[('pending'::character varying)::text, ('assigned'::character varying)::text, ('unknown'::character varying)::text, ('clustered'::character varying)::text]));