-- Breaking reshape of orders into a multi-line aggregate. Legacy single-product order
-- rows are incompatible with the new NOT NULL total_cents column; per plan, dev/legacy
-- orders are dropped (a production cutover would backfill total_cents instead).
DELETE FROM "orders";--> statement-breakpoint
CREATE TABLE "order_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"sku_snapshot" text NOT NULL,
	"unit_price_cents" integer NOT NULL,
	"quantity" integer NOT NULL,
	"line_total_cents" integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE "orders" ALTER COLUMN "status" SET DEFAULT 'pending';--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "total_cents" integer NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "currency" text DEFAULT 'USD' NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" DROP COLUMN "product";--> statement-breakpoint
ALTER TABLE "orders" DROP COLUMN "quantity";--> statement-breakpoint
ALTER TABLE "orders" DROP COLUMN "amount";