CREATE TABLE "form_collaborators" (
	"id" serial PRIMARY KEY NOT NULL,
	"form_id" integer NOT NULL,
	"user_id" integer,
	"email" varchar(255) NOT NULL,
	"role" varchar(20) DEFAULT 'viewer' NOT NULL,
	"invited_by" integer,
	"created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
	"updated_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "chk_collaborator_role" CHECK ((role)::text = 'viewer'::text)
);
--> statement-breakpoint
ALTER TABLE "form_collaborators" ADD CONSTRAINT "fk_collaborator_form" FOREIGN KEY ("form_id") REFERENCES "public"."forms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_collaborators" ADD CONSTRAINT "fk_collaborator_user" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_collaborators" ADD CONSTRAINT "fk_collaborator_inviter" FOREIGN KEY ("invited_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_form_collaborators_email" ON "form_collaborators" USING btree (lower((email)::text));--> statement-breakpoint
CREATE INDEX "idx_form_collaborators_user_id" ON "form_collaborators" USING btree ("user_id" int4_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "uq_form_collaborator_email" ON "form_collaborators" USING btree (form_id,lower((email)::text));