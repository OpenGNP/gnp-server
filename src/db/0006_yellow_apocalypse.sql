CREATE TABLE "form_opens" (
	"user_id" integer NOT NULL,
	"form_id" integer NOT NULL,
	"opened_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "form_opens_pkey" PRIMARY KEY("form_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "form_opens" ADD CONSTRAINT "fk_open_user" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_opens" ADD CONSTRAINT "fk_open_form" FOREIGN KEY ("form_id") REFERENCES "public"."forms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_form_opens_user_recent" ON "form_opens" USING btree ("user_id" int4_ops,"opened_at" int4_ops);