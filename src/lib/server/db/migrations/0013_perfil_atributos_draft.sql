CREATE TABLE "person_attribute" (
	"id" uuid PRIMARY KEY NOT NULL,
	"person_id" uuid NOT NULL,
	"physical" integer,
	"biblical" integer,
	"mental" integer,
	"motor" integer,
	"height_cm" integer,
	"weight_tenths_kg" integer,
	"dominant_side" text,
	"shirt_size" text,
	"strengths" text,
	"draft_notes" text,
	"evaluated_by_person_id" uuid,
	"evaluated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "person_attribute" ADD CONSTRAINT "person_attribute_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_attribute" ADD CONSTRAINT "person_attribute_evaluated_by_person_id_person_id_fk" FOREIGN KEY ("evaluated_by_person_id") REFERENCES "public"."person"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "person_attribute_person_idx" ON "person_attribute" USING btree ("person_id");--> statement-breakpoint

ALTER TABLE "person_attribute"
	ADD CONSTRAINT "person_attribute_physical_range" CHECK ("physical" IS NULL OR ("physical" >= 0 AND "physical" <= 10));
--> statement-breakpoint
ALTER TABLE "person_attribute"
	ADD CONSTRAINT "person_attribute_biblical_range" CHECK ("biblical" IS NULL OR ("biblical" >= 0 AND "biblical" <= 10));
--> statement-breakpoint
ALTER TABLE "person_attribute"
	ADD CONSTRAINT "person_attribute_mental_range" CHECK ("mental" IS NULL OR ("mental" >= 0 AND "mental" <= 10));
--> statement-breakpoint
ALTER TABLE "person_attribute"
	ADD CONSTRAINT "person_attribute_motor_range" CHECK ("motor" IS NULL OR ("motor" >= 0 AND "motor" <= 10));
--> statement-breakpoint
ALTER TABLE "person_attribute"
	ADD CONSTRAINT "person_attribute_height_range" CHECK ("height_cm" IS NULL OR ("height_cm" >= 100 AND "height_cm" <= 250));
--> statement-breakpoint
ALTER TABLE "person_attribute"
	ADD CONSTRAINT "person_attribute_weight_range" CHECK ("weight_tenths_kg" IS NULL OR ("weight_tenths_kg" >= 300 AND "weight_tenths_kg" <= 2500));
--> statement-breakpoint
ALTER TABLE "person_attribute"
	ADD CONSTRAINT "person_attribute_dominant_side_valid" CHECK ("dominant_side" IS NULL OR "dominant_side" IN ('destro', 'canhoto', 'ambidestro'));
--> statement-breakpoint
ALTER TABLE "person_attribute"
	ADD CONSTRAINT "person_attribute_shirt_size_valid" CHECK ("shirt_size" IS NULL OR "shirt_size" IN ('PP', 'P', 'M', 'G', 'GG', 'XG'));
--> statement-breakpoint

CREATE TABLE "draft_session" (
	"id" uuid PRIMARY KEY NOT NULL,
	"team_id" uuid NOT NULL,
	"title" text NOT NULL,
	"notes" text,
	"focus" text DEFAULT 'equilibrado' NOT NULL,
	"teams" jsonb NOT NULL,
	"created_by_person_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "draft_session" ADD CONSTRAINT "draft_session_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "draft_session" ADD CONSTRAINT "draft_session_created_by_person_id_person_id_fk" FOREIGN KEY ("created_by_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "draft_session_team_idx" ON "draft_session" USING btree ("team_id","created_at");--> statement-breakpoint

ALTER TABLE "draft_session"
	ADD CONSTRAINT "draft_session_focus_valid" CHECK ("focus" IN ('equilibrado', 'fisico', 'biblico', 'mental', 'coordenacao'));
