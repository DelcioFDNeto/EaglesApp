CREATE TABLE "attendance" (
	"id" uuid PRIMARY KEY NOT NULL,
	"event_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"recorded_by_person_id" uuid,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "event_type_rsvp_option" (
	"type_id" uuid NOT NULL,
	"option_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rsvp" (
	"id" uuid PRIMARY KEY NOT NULL,
	"event_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"option_id" uuid NOT NULL,
	"guests" smallint DEFAULT 0 NOT NULL,
	"responded_by_person_id" uuid,
	"responded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rsvp_history" (
	"id" uuid PRIMARY KEY NOT NULL,
	"event_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"option_id" uuid NOT NULL,
	"guests" smallint DEFAULT 0 NOT NULL,
	"responded_by_person_id" uuid,
	"responded_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rsvp_option" (
	"id" uuid PRIMARY KEY NOT NULL,
	"team_id" uuid NOT NULL,
	"label" text NOT NULL,
	"semantic" text NOT NULL,
	"allows_guests" boolean DEFAULT false NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "event" ADD COLUMN "attendance_taken_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "event" ADD COLUMN "attendance_taken_by_person_id" uuid;--> statement-breakpoint
ALTER TABLE "event_type" ADD COLUMN "counts_for_attendance" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "attendance" ADD CONSTRAINT "attendance_event_id_event_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."event"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance" ADD CONSTRAINT "attendance_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance" ADD CONSTRAINT "attendance_recorded_by_person_id_person_id_fk" FOREIGN KEY ("recorded_by_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_type_rsvp_option" ADD CONSTRAINT "event_type_rsvp_option_type_id_event_type_id_fk" FOREIGN KEY ("type_id") REFERENCES "public"."event_type"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_type_rsvp_option" ADD CONSTRAINT "event_type_rsvp_option_option_id_rsvp_option_id_fk" FOREIGN KEY ("option_id") REFERENCES "public"."rsvp_option"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rsvp" ADD CONSTRAINT "rsvp_event_id_event_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."event"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rsvp" ADD CONSTRAINT "rsvp_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rsvp" ADD CONSTRAINT "rsvp_option_id_rsvp_option_id_fk" FOREIGN KEY ("option_id") REFERENCES "public"."rsvp_option"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rsvp" ADD CONSTRAINT "rsvp_responded_by_person_id_person_id_fk" FOREIGN KEY ("responded_by_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rsvp_history" ADD CONSTRAINT "rsvp_history_event_id_event_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."event"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rsvp_history" ADD CONSTRAINT "rsvp_history_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rsvp_history" ADD CONSTRAINT "rsvp_history_option_id_rsvp_option_id_fk" FOREIGN KEY ("option_id") REFERENCES "public"."rsvp_option"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rsvp_history" ADD CONSTRAINT "rsvp_history_responded_by_person_id_person_id_fk" FOREIGN KEY ("responded_by_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rsvp_option" ADD CONSTRAINT "rsvp_option_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "attendance_evento_pessoa_idx" ON "attendance" USING btree ("event_id","person_id");--> statement-breakpoint
CREATE INDEX "attendance_pessoa_idx" ON "attendance" USING btree ("person_id");--> statement-breakpoint
CREATE UNIQUE INDEX "event_type_rsvp_option_idx" ON "event_type_rsvp_option" USING btree ("type_id","option_id");--> statement-breakpoint
CREATE UNIQUE INDEX "rsvp_evento_pessoa_idx" ON "rsvp" USING btree ("event_id","person_id");--> statement-breakpoint
CREATE INDEX "rsvp_pessoa_idx" ON "rsvp" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX "rsvp_history_evento_pessoa_idx" ON "rsvp_history" USING btree ("event_id","person_id","responded_at");--> statement-breakpoint
CREATE INDEX "rsvp_option_team_idx" ON "rsvp_option" USING btree ("team_id","position");--> statement-breakpoint
ALTER TABLE "event" ADD CONSTRAINT "event_attendance_taken_by_person_id_person_id_fk" FOREIGN KEY ("attendance_taken_by_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;