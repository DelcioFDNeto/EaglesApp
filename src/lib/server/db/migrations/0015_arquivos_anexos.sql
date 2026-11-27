CREATE TABLE "file_asset" (
	"id" uuid PRIMARY KEY NOT NULL,
	"team_id" uuid NOT NULL,
	"scope" text NOT NULL,
	"owner_person_id" uuid,
	"filename" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"data_base64" text NOT NULL,
	"uploaded_by_person_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "file_asset" ADD CONSTRAINT "file_asset_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_asset" ADD CONSTRAINT "file_asset_owner_person_id_person_id_fk" FOREIGN KEY ("owner_person_id") REFERENCES "public"."person"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_asset" ADD CONSTRAINT "file_asset_uploaded_by_person_id_person_id_fk" FOREIGN KEY ("uploaded_by_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "file_asset_team_scope_idx" ON "file_asset" USING btree ("team_id","scope");--> statement-breakpoint
ALTER TABLE "file_asset"
	ADD CONSTRAINT "file_asset_scope_valid" CHECK ("scope" IN ('perfil_foto', 'comprovante', 'evento_anexo'));
--> statement-breakpoint
ALTER TABLE "file_asset"
	ADD CONSTRAINT "file_asset_mime_valid" CHECK ("mime_type" IN ('image/jpeg', 'image/png', 'image/webp', 'application/pdf'));
--> statement-breakpoint
ALTER TABLE "file_asset"
	ADD CONSTRAINT "file_asset_size_valid" CHECK ("size_bytes" > 0 AND "size_bytes" <= 3145728);
--> statement-breakpoint

CREATE TABLE "event_attachment" (
	"id" uuid PRIMARY KEY NOT NULL,
	"event_id" uuid NOT NULL,
	"file_asset_id" uuid NOT NULL,
	"title" text NOT NULL,
	"uploaded_by_person_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "event_attachment" ADD CONSTRAINT "event_attachment_event_id_event_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."event"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_attachment" ADD CONSTRAINT "event_attachment_file_asset_id_file_asset_id_fk" FOREIGN KEY ("file_asset_id") REFERENCES "public"."file_asset"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_attachment" ADD CONSTRAINT "event_attachment_uploaded_by_person_id_person_id_fk" FOREIGN KEY ("uploaded_by_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "event_attachment_event_idx" ON "event_attachment" USING btree ("event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "event_attachment_file_idx" ON "event_attachment" USING btree ("file_asset_id");
