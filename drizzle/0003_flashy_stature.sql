CREATE TABLE "agent_dispatch" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"conversation_id" text NOT NULL,
	"source_message_id" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"available_at" timestamp DEFAULT now() NOT NULL,
	"lease_until" timestamp,
	"last_error_code" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "message" DROP CONSTRAINT "message_wa_message_id_unique";--> statement-breakpoint
ALTER TABLE "message" ADD COLUMN "idempotency_key" text;--> statement-breakpoint
ALTER TABLE "message" ADD COLUMN "delivery_state" text;--> statement-breakpoint
ALTER TABLE "message" ADD COLUMN "delivery_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "message" ADD COLUMN "delivery_lease_until" timestamp;--> statement-breakpoint
ALTER TABLE "message" ADD COLUMN "last_error_code" text;--> statement-breakpoint
ALTER TABLE "message" ADD COLUMN "processed_at" timestamp;--> statement-breakpoint
UPDATE "message"
SET "processed_at" = COALESCE("wa_timestamp", "created_at")
WHERE "direction" = 'in';--> statement-breakpoint
UPDATE "message"
SET "delivery_state" = CASE
  WHEN "status" = 'failed' THEN 'failed'
  ELSE 'sent'
END
WHERE "direction" = 'out';--> statement-breakpoint
ALTER TABLE "agent_dispatch" ADD CONSTRAINT "agent_dispatch_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_dispatch" ADD CONSTRAINT "agent_dispatch_conversation_id_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_dispatch" ADD CONSTRAINT "agent_dispatch_source_message_id_message_id_fk" FOREIGN KEY ("source_message_id") REFERENCES "public"."message"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agent_dispatch_org_source_uq" ON "agent_dispatch" USING btree ("organization_id","source_message_id");--> statement-breakpoint
CREATE INDEX "agent_dispatch_org_status_idx" ON "agent_dispatch" USING btree ("organization_id","status","available_at","lease_until");--> statement-breakpoint
CREATE UNIQUE INDEX "message_org_wa_uq" ON "message" USING btree ("organization_id","wa_message_id") WHERE "message"."wa_message_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "message_org_idempotency_uq" ON "message" USING btree ("organization_id","idempotency_key") WHERE "message"."idempotency_key" is not null;--> statement-breakpoint
CREATE INDEX "message_org_delivery_idx" ON "message" USING btree ("organization_id","delivery_state","delivery_lease_until");