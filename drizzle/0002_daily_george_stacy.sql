ALTER TABLE "outbox_messages" ADD COLUMN "event_id" uuid DEFAULT gen_random_uuid() NOT NULL;--> statement-breakpoint
ALTER TABLE "outbox_messages" ADD COLUMN "correlation_id" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "role" text DEFAULT 'customer' NOT NULL;--> statement-breakpoint
ALTER TABLE "processed_messages" ADD COLUMN "consumer_name" text NOT NULL;--> statement-breakpoint
ALTER TABLE "processed_messages" ADD COLUMN "event_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "processed_messages" DROP COLUMN "message_id";--> statement-breakpoint
ALTER TABLE "processed_messages" ADD CONSTRAINT "processed_messages_consumer_name_event_id_pk" PRIMARY KEY("consumer_name","event_id");
