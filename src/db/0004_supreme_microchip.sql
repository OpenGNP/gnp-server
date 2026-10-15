ALTER TABLE "points" RENAME COLUMN "is_severe" TO "is_violation";--> statement-breakpoint
ALTER TABLE "points" DROP CONSTRAINT "chk_labels_together";--> statement-breakpoint
ALTER TABLE "points" ADD CONSTRAINT "chk_labels_together" CHECK ((sentiment_label IS NULL) = (is_violation IS NULL));