CREATE TYPE "public"."user_role" AS ENUM('customer', 'admin');--> statement-breakpoint
-- Drop the text default before changing the column type, convert existing text values with an
-- explicit cast, then restore the default as the enum type. (Drizzle emits these out of order.)
ALTER TABLE "users" ALTER COLUMN "role" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "role" SET DATA TYPE "public"."user_role" USING "role"::"public"."user_role";--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "role" SET DEFAULT 'customer';
