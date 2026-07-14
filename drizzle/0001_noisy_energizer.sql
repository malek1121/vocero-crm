CREATE TABLE "baileys_auth" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"key" text NOT NULL,
	"value_cipher" text NOT NULL,
	"value_iv" text NOT NULL,
	"value_tag" text NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "baileys_auth" ADD CONSTRAINT "baileys_auth_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "baileys_auth_org_key_uq" ON "baileys_auth" USING btree ("organization_id","key");