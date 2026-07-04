ALTER TABLE "users" ADD COLUMN "roles" text[] DEFAULT '{"customer"}' NOT NULL;--> statement-breakpoint
UPDATE "users" SET "roles" = ARRAY["role"::text];--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "role";--> statement-breakpoint
DROP TYPE "public"."user_role";
