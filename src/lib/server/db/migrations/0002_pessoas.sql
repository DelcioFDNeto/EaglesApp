CREATE TABLE "consent" (
	"id" uuid PRIMARY KEY NOT NULL,
	"person_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"granted" boolean NOT NULL,
	"granted_by_person_id" uuid,
	"recorded_by_person_id" uuid,
	"evidence" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "membership_status" (
	"id" uuid PRIMARY KEY NOT NULL,
	"team_id" uuid NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"position" integer DEFAULT 0 NOT NULL,
	"color" text,
	"is_terminal" boolean DEFAULT false NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"grants_role_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "person_relation" (
	"id" uuid PRIMARY KEY NOT NULL,
	"team_id" uuid NOT NULL,
	"person_a" uuid NOT NULL,
	"person_b" uuid NOT NULL,
	"relation_type" text NOT NULL,
	"created_by_person_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "person_status_history" (
	"id" uuid PRIMARY KEY NOT NULL,
	"person_id" uuid NOT NULL,
	"from_status_id" uuid,
	"to_status_id" uuid NOT NULL,
	"changed_by_person_id" uuid,
	"reason" text,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "person" ADD COLUMN "full_name_normalized" text GENERATED ALWAYS AS (translate(lower("full_name"),
				'áàâãäéèêëíìîïóòôõöúùûüçñ',
				'aaaaaeeeeiiiiooooouuuucn')) STORED;--> statement-breakpoint
ALTER TABLE "person" ADD COLUMN "phone" text;--> statement-breakpoint
ALTER TABLE "person" ADD COLUMN "whatsapp" text;--> statement-breakpoint
ALTER TABLE "person" ADD COLUMN "email" text;--> statement-breakpoint
ALTER TABLE "person" ADD COLUMN "relationship_status" text;--> statement-breakpoint
ALTER TABLE "person" ADD COLUMN "joined_at" date;--> statement-breakpoint
ALTER TABLE "person" ADD COLUMN "current_status_id" uuid;--> statement-breakpoint
ALTER TABLE "person" ADD COLUMN "source" text DEFAULT 'cadastro' NOT NULL;--> statement-breakpoint
ALTER TABLE "consent" ADD CONSTRAINT "consent_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consent" ADD CONSTRAINT "consent_granted_by_person_id_person_id_fk" FOREIGN KEY ("granted_by_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consent" ADD CONSTRAINT "consent_recorded_by_person_id_person_id_fk" FOREIGN KEY ("recorded_by_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership_status" ADD CONSTRAINT "membership_status_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership_status" ADD CONSTRAINT "membership_status_grants_role_id_role_id_fk" FOREIGN KEY ("grants_role_id") REFERENCES "public"."role"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_relation" ADD CONSTRAINT "person_relation_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_relation" ADD CONSTRAINT "person_relation_person_a_person_id_fk" FOREIGN KEY ("person_a") REFERENCES "public"."person"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_relation" ADD CONSTRAINT "person_relation_person_b_person_id_fk" FOREIGN KEY ("person_b") REFERENCES "public"."person"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_relation" ADD CONSTRAINT "person_relation_created_by_person_id_person_id_fk" FOREIGN KEY ("created_by_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_status_history" ADD CONSTRAINT "person_status_history_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_status_history" ADD CONSTRAINT "person_status_history_from_status_id_membership_status_id_fk" FOREIGN KEY ("from_status_id") REFERENCES "public"."membership_status"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_status_history" ADD CONSTRAINT "person_status_history_to_status_id_membership_status_id_fk" FOREIGN KEY ("to_status_id") REFERENCES "public"."membership_status"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_status_history" ADD CONSTRAINT "person_status_history_changed_by_person_id_person_id_fk" FOREIGN KEY ("changed_by_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "consent_person_kind_idx" ON "consent" USING btree ("person_id","kind","at");--> statement-breakpoint
CREATE UNIQUE INDEX "membership_status_team_key_idx" ON "membership_status" USING btree ("team_id","key");--> statement-breakpoint
CREATE INDEX "membership_status_position_idx" ON "membership_status" USING btree ("team_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "person_relation_par_idx" ON "person_relation" USING btree ("person_a","person_b","relation_type");--> statement-breakpoint
CREATE INDEX "person_relation_a_idx" ON "person_relation" USING btree ("person_a");--> statement-breakpoint
CREATE INDEX "person_relation_b_idx" ON "person_relation" USING btree ("person_b");--> statement-breakpoint
CREATE INDEX "person_status_history_person_idx" ON "person_status_history" USING btree ("person_id","occurred_at");--> statement-breakpoint
ALTER TABLE "person" ADD CONSTRAINT "person_current_status_id_membership_status_id_fk" FOREIGN KEY ("current_status_id") REFERENCES "public"."membership_status"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "person_status_idx" ON "person" USING btree ("current_status_id");