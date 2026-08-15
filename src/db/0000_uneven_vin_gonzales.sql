-- Current sql file was generated after introspecting the database
-- If you want to run this migration please uncomment this code before executing migrations
/*
CREATE TABLE "answers" (
	"id" serial NOT NULL,
	"submission_id" integer NOT NULL,
	"field_id" integer NOT NULL,
	"answer_text" text,
	"answer_option_id" integer,
	"created_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "topic_trends" (
	"id" serial NOT NULL,
	"canonical_topic_id" integer NOT NULL,
	"period_start" timestamp,
	"period_end" timestamp,
	"feedback_count" integer,
	"positive_count" integer,
	"neutral_count" integer,
	"negative_count" integer,
	"severe_count" integer,
	"created_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "points" (
	"id" serial NOT NULL,
	"answer_id" integer NOT NULL,
	"canonical_topic_id" integer,
	"point_text" text,
	"embedding" vector,
	"sentiment_label" varchar(20),
	"is_severe" boolean,
	"assignment_confidence" real,
	"processing_status" varchar(30),
	"created_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "canonical_topics" (
	"id" serial NOT NULL,
	"canonical_name" varchar(255),
	"canonical_summary" text,
	"representative_keywords" text,
	"centroid_vector" vector,
	"topic_size" integer,
	"status" varchar(20),
	"first_detected_at" timestamp,
	"last_updated_at" timestamp,
	"created_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "topic_versions" (
	"id" serial NOT NULL,
	"canonical_topic_id" integer NOT NULL,
	"generated_title" varchar(255),
	"generated_summary" text,
	"representative_keywords" text,
	"model_version" varchar(100),
	"created_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "unassigned_points" (
	"id" serial NOT NULL,
	"point_id" integer NOT NULL,
	"embedding" vector,
	"reason" varchar(100),
	"created_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "ai_model_runs" (
	"id" serial NOT NULL,
	"model_name" varchar(100),
	"model_version" varchar(100),
	"embedding_model" varchar(100),
	"clustering_algorithm" varchar(100),
	"parameters" text,
	"started_at" timestamp,
	"completed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" serial NOT NULL,
	"organization_name" varchar(255),
	"organization_domain" varchar(255),
	"created_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial NOT NULL,
	"full_name" varchar(255),
	"email" varchar(255) NOT NULL,
	"password" varchar(255),
	"role" varchar(50),
	"organization_id" integer,
	"created_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "folders" (
	"id" serial NOT NULL,
	"admin_id" integer NOT NULL,
	"folder_name" varchar(255),
	"folder_description" text,
	"created_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "forms" (
	"id" serial NOT NULL,
	"admin_id" integer NOT NULL,
	"folder_id" integer,
	"form_title" varchar(255),
	"form_description" text,
	"status" varchar(20),
	"access_type" varchar(30),
	"record_name" boolean,
	"one_response_per_person" boolean,
	"organization_id" integer,
	"start_date" timestamp,
	"end_date" timestamp,
	"created_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "form_allowed_users" (
	"id" serial NOT NULL,
	"form_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"created_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "form_fields" (
	"id" serial NOT NULL,
	"form_id" integer NOT NULL,
	"field_label" varchar(255),
	"field_type" varchar(30),
	"is_required" boolean,
	"field_order" integer,
	"created_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "field_options" (
	"id" serial NOT NULL,
	"field_id" integer NOT NULL,
	"option_label" varchar(255),
	"option_value" varchar(255),
	"option_order" integer,
	"created_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "submissions" (
	"id" serial NOT NULL,
	"form_id" integer NOT NULL,
	"user_id" integer,
	"anonymous_code" varchar(100),
	"submission_status" varchar(30),
	"created_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "answers" ADD CONSTRAINT "fk_answer_submission" FOREIGN KEY ("submission_id") REFERENCES "public"."submissions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "answers" ADD CONSTRAINT "fk_answer_field" FOREIGN KEY ("field_id") REFERENCES "public"."form_fields"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "answers" ADD CONSTRAINT "fk_answer_option" FOREIGN KEY ("answer_option_id") REFERENCES "public"."field_options"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topic_trends" ADD CONSTRAINT "fk_topic_trend" FOREIGN KEY ("canonical_topic_id") REFERENCES "public"."canonical_topics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "points" ADD CONSTRAINT "fk_point_answer" FOREIGN KEY ("answer_id") REFERENCES "public"."answers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "points" ADD CONSTRAINT "fk_point_topic" FOREIGN KEY ("canonical_topic_id") REFERENCES "public"."canonical_topics"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topic_versions" ADD CONSTRAINT "fk_topic_version" FOREIGN KEY ("canonical_topic_id") REFERENCES "public"."canonical_topics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unassigned_points" ADD CONSTRAINT "fk_unassigned_point" FOREIGN KEY ("point_id") REFERENCES "public"."points"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "fk_user_organization" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "folders" ADD CONSTRAINT "fk_folder_admin" FOREIGN KEY ("admin_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forms" ADD CONSTRAINT "fk_form_admin" FOREIGN KEY ("admin_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forms" ADD CONSTRAINT "fk_form_folder" FOREIGN KEY ("folder_id") REFERENCES "public"."folders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forms" ADD CONSTRAINT "fk_form_organization" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_allowed_users" ADD CONSTRAINT "fk_allowed_form" FOREIGN KEY ("form_id") REFERENCES "public"."forms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_allowed_users" ADD CONSTRAINT "fk_allowed_user" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_fields" ADD CONSTRAINT "fk_field_form" FOREIGN KEY ("form_id") REFERENCES "public"."forms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "field_options" ADD CONSTRAINT "fk_option_field" FOREIGN KEY ("field_id") REFERENCES "public"."form_fields"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "fk_submission_form" FOREIGN KEY ("form_id") REFERENCES "public"."forms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "fk_submission_user" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
*/