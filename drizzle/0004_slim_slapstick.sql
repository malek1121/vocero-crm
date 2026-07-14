ALTER TABLE "organization" ADD COLUMN "whatsapp_phone" text;--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "whatsapp_initial_imported_at" timestamp;
--> statement-breakpoint
UPDATE "organization" AS o
SET "whatsapp_initial_imported_at" = now()
WHERE EXISTS (
  SELECT 1
  FROM "baileys_auth" AS a
  WHERE a."organization_id" = o."id"
    AND a."key" = 'creds'
);
