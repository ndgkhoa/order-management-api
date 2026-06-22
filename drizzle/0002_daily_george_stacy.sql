-- processed_messages dedup key moves from the outbox row id to a composite
-- (consumer_name, event_id): the consumer dimension lets independent consumers each
-- process the same logical event once without blocking one another (fan-out safe).
-- NOT-NULL-without-default adds on processed_messages are safe: it holds only transient
-- dedup state and is empty when this migration runs.
ALTER TABLE "outbox_messages" ADD COLUMN "event_id" uuid DEFAULT gen_random_uuid() NOT NULL;--> statement-breakpoint
ALTER TABLE "outbox_messages" ADD COLUMN "correlation_id" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "role" text DEFAULT 'customer' NOT NULL;--> statement-breakpoint
ALTER TABLE "processed_messages" ADD COLUMN "consumer_name" text NOT NULL;--> statement-breakpoint
ALTER TABLE "processed_messages" ADD COLUMN "event_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "processed_messages" DROP COLUMN "message_id";--> statement-breakpoint
ALTER TABLE "processed_messages" ADD CONSTRAINT "processed_messages_consumer_name_event_id_pk" PRIMARY KEY("consumer_name","event_id");
