import { pgTable, serial, varchar, timestamp, index, foreignKey, unique, check, integer, text, boolean, uniqueIndex, uuid, vector, real, primaryKey } from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"



export const organizations = pgTable("organizations", {
	id: serial().primaryKey().notNull(),
	organizationName: varchar("organization_name", { length: 255 }),
	organizationDomain: varchar("organization_domain", { length: 255 }),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).default(sql`CURRENT_TIMESTAMP`),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const users = pgTable("users", {
	id: serial().primaryKey().notNull(),
	fullName: varchar("full_name", { length: 255 }),
	email: varchar({ length: 255 }).notNull(),
	password: varchar({ length: 255 }),
	role: varchar({ length: 50 }),
	organizationId: integer("organization_id"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).default(sql`CURRENT_TIMESTAMP`),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).default(sql`CURRENT_TIMESTAMP`).notNull(),
	avatarKey: text("avatar_key"),
}, (table) => [
	index("idx_users_organization_id").using("btree", table.organizationId.asc().nullsLast().op("int4_ops")),
	foreignKey({
			columns: [table.organizationId],
			foreignColumns: [organizations.id],
			name: "fk_user_organization"
		}).onDelete("set null"),
	unique("users_email_key").on(table.email),
	check("chk_role", sql`(role)::text = ANY ((ARRAY['user'::character varying, 'staff'::character varying, 'admin'::character varying, 'superadmin'::character varying])::text[])`),
]);

export const formFields = pgTable("form_fields", {
	id: serial().primaryKey().notNull(),
	formId: integer("form_id").notNull(),
	fieldLabel: varchar("field_label", { length: 255 }),
	fieldType: varchar("field_type", { length: 30 }),
	section: varchar({ length: 20 }).default('feedback').notNull(),
	analyzeWithAi: boolean("analyze_with_ai").default(false).notNull(),
	allowOther: boolean("allow_other").default(false).notNull(),
	isRequired: boolean("is_required").default(false),
	fieldOrder: integer("field_order"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).default(sql`CURRENT_TIMESTAMP`),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).default(sql`CURRENT_TIMESTAMP`).notNull(),
	deletedAt: timestamp("deleted_at", { withTimezone: true, mode: 'string' }),
}, (table) => [
	index("idx_form_fields_form_id").using("btree", table.formId.asc().nullsLast().op("int4_ops")),
	foreignKey({
			columns: [table.formId],
			foreignColumns: [forms.id],
			name: "fk_field_form"
		}).onDelete("cascade"),
	check("chk_field_type", sql`(field_type)::text = ANY ((ARRAY['text'::character varying, 'textarea'::character varying, 'checkbox'::character varying, 'radio'::character varying])::text[])`),
	check("chk_field_section", sql`(section)::text = ANY ((ARRAY['demographic'::character varying, 'feedback'::character varying])::text[])`),
]);

export const forms = pgTable("forms", {
	id: serial().primaryKey().notNull(),
	adminId: integer("admin_id").notNull(),
	folderId: integer("folder_id"),
	organizationId: integer("organization_id"),
	formTitle: varchar("form_title", { length: 255 }),
	formDescription: text("form_description"),
	coverImageUrl: text("cover_image_url"),
	status: varchar({ length: 20 }).default('draft').notNull(),
	acceptingResponses: boolean("accepting_responses").default(true).notNull(),
	publishedAt: timestamp("published_at", { withTimezone: true, mode: 'string' }),
	publicToken: uuid("public_token").defaultRandom().notNull(),
	accessType: varchar("access_type", { length: 30 }).default('organization').notNull(),
	recordName: boolean("record_name").default(false),
	oneResponsePerPerson: boolean("one_response_per_person").default(false),
	sortOrder: integer("sort_order").default(0).notNull(),
	startDate: timestamp("start_date", { withTimezone: true, mode: 'string' }),
	endDate: timestamp("end_date", { withTimezone: true, mode: 'string' }),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).default(sql`CURRENT_TIMESTAMP`),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).default(sql`CURRENT_TIMESTAMP`).notNull(),
	urlId: uuid("url_id").defaultRandom().notNull(),
}, (table) => [
	index("idx_forms_admin_status").using("btree", table.adminId.asc().nullsLast().op("int4_ops"), table.status.asc().nullsLast().op("text_ops")),
	index("idx_forms_folder_id").using("btree", table.folderId.asc().nullsLast().op("int4_ops")),
	index("idx_forms_organization_id").using("btree", table.organizationId.asc().nullsLast().op("int4_ops")),
	uniqueIndex("uq_forms_url_id").using("btree", table.urlId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.adminId],
			foreignColumns: [users.id],
			name: "fk_form_admin"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.folderId],
			foreignColumns: [folders.id],
			name: "fk_form_folder"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.organizationId],
			foreignColumns: [organizations.id],
			name: "fk_form_organization"
		}).onDelete("set null"),
	unique("uq_form_public_token").on(table.publicToken),
	check("chk_form_status", sql`(status)::text = ANY ((ARRAY['draft'::character varying, 'active'::character varying, 'closed'::character varying, 'archived'::character varying])::text[])`),
	check("chk_access_type", sql`(access_type)::text = ANY ((ARRAY['public'::character varying, 'organization'::character varying, 'specific'::character varying])::text[])`),
]);

export const folders = pgTable("folders", {
	id: serial().primaryKey().notNull(),
	adminId: integer("admin_id").notNull(),
	parentFolderId: integer("parent_folder_id"),
	folderName: varchar("folder_name", { length: 255 }),
	folderDescription: text("folder_description"),
	sortOrder: integer("sort_order").default(0).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).default(sql`CURRENT_TIMESTAMP`),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => [
	index("idx_folders_parent_folder_id").using("btree", table.parentFolderId.asc().nullsLast().op("int4_ops")),
	uniqueIndex("uq_folder_sibling_name").using("btree", sql`admin_id`, sql`COALESCE(parent_folder_id, 0)`, sql`lower((folder_name)::text)`),
	foreignKey({
			columns: [table.adminId],
			foreignColumns: [users.id],
			name: "fk_folder_admin"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.parentFolderId],
			foreignColumns: [table.id],
			name: "fk_folder_parent"
		}).onDelete("cascade"),
]);

export const fieldOptions = pgTable("field_options", {
	id: serial().primaryKey().notNull(),
	fieldId: integer("field_id").notNull(),
	optionLabel: varchar("option_label", { length: 255 }),
	optionValue: varchar("option_value", { length: 255 }),
	optionOrder: integer("option_order"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).default(sql`CURRENT_TIMESTAMP`),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).default(sql`CURRENT_TIMESTAMP`).notNull(),
	deletedAt: timestamp("deleted_at", { withTimezone: true, mode: 'string' }),
}, (table) => [
	index("idx_field_options_field_id").using("btree", table.fieldId.asc().nullsLast().op("int4_ops")),
	foreignKey({
			columns: [table.fieldId],
			foreignColumns: [formFields.id],
			name: "fk_option_field"
		}).onDelete("cascade"),
]);

export const submissions = pgTable("submissions", {
	id: serial().primaryKey().notNull(),
	formId: integer("form_id").notNull(),
	userId: integer("user_id"),
	anonymousCode: varchar("anonymous_code", { length: 100 }),
	respondentName: varchar("respondent_name", { length: 255 }),
	submissionStatus: varchar("submission_status", { length: 30 }).default('submitted').notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).default(sql`CURRENT_TIMESTAMP`),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => [
	index("idx_submissions_form_id").using("btree", table.formId.asc().nullsLast().op("int4_ops")),
	index("idx_submissions_user_id").using("btree", table.userId.asc().nullsLast().op("int4_ops")),
	foreignKey({
			columns: [table.formId],
			foreignColumns: [forms.id],
			name: "fk_submission_form"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "fk_submission_user"
		}).onDelete("set null"),
	check("chk_submission_status", sql`(submission_status)::text = ANY ((ARRAY['submitted'::character varying, 'processing'::character varying, 'completed'::character varying, 'failed'::character varying])::text[])`),
]);

export const answers = pgTable("answers", {
	id: serial().primaryKey().notNull(),
	submissionId: integer("submission_id").notNull(),
	fieldId: integer("field_id").notNull(),
	answerText: text("answer_text"),
	answerOptionId: integer("answer_option_id"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).default(sql`CURRENT_TIMESTAMP`),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).default(sql`CURRENT_TIMESTAMP`).notNull(),
	decomposedAt: timestamp("decomposed_at", { withTimezone: true, mode: 'string' }),
}, (table) => [
	index("idx_answers_answer_option_id").using("btree", table.answerOptionId.asc().nullsLast().op("int4_ops")),
	index("idx_answers_field_id").using("btree", table.fieldId.asc().nullsLast().op("int4_ops")),
	index("idx_answers_submission_id").using("btree", table.submissionId.asc().nullsLast().op("int4_ops")),
	index("idx_answers_to_decompose").using("btree", table.id.asc().nullsLast().op("int4_ops")).where(sql`((decomposed_at IS NULL) AND (answer_text IS NOT NULL))`),
	foreignKey({
			columns: [table.submissionId],
			foreignColumns: [submissions.id],
			name: "fk_answer_submission"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.fieldId],
			foreignColumns: [formFields.id],
			name: "fk_answer_field"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.answerOptionId],
			foreignColumns: [fieldOptions.id],
			name: "fk_answer_option"
		}).onDelete("set null"),
]);

export const canonicalTopics = pgTable("canonical_topics", {
	id: serial().primaryKey().notNull(),
	formId: integer("form_id").notNull(),
	canonicalName: varchar("canonical_name", { length: 255 }),
	canonicalSummary: text("canonical_summary"),
	representativeKeywords: text("representative_keywords"),
	centroidVector: vector("centroid_vector", { dimensions: 384 }),
	topicSize: integer("topic_size"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).default(sql`CURRENT_TIMESTAMP`),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => [
	index("idx_canonical_topics_form_id").using("btree", table.formId.asc().nullsLast().op("int4_ops")),
	foreignKey({
			columns: [table.formId],
			foreignColumns: [forms.id],
			name: "fk_topic_form"
		}).onDelete("cascade"),
]);

export const formAllowedUsers = pgTable("form_allowed_users", {
	id: serial().primaryKey().notNull(),
	formId: integer("form_id").notNull(),
	userId: integer("user_id"),
	email: varchar({ length: 255 }).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).default(sql`CURRENT_TIMESTAMP`),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => [
	foreignKey({
			columns: [table.formId],
			foreignColumns: [forms.id],
			name: "fk_allowed_form"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "fk_allowed_user"
		}).onDelete("set null"),
	unique("form_allowed_users_form_id_email_key").on(table.email, table.formId),
]);

export const aiModelRuns = pgTable("ai_model_runs", {
	id: serial().primaryKey().notNull(),
	formId: integer("form_id").notNull(),
	modelName: varchar("model_name", { length: 100 }),
	modelVersion: varchar("model_version", { length: 100 }),
	embeddingModel: varchar("embedding_model", { length: 100 }),
	clusteringAlgorithm: varchar("clustering_algorithm", { length: 100 }),
	parameters: text(),
	status: varchar({ length: 20 }).default('running').notNull(),
	error: text(),
	startedAt: timestamp("started_at", { withTimezone: true, mode: 'string' }),
	completedAt: timestamp("completed_at", { withTimezone: true, mode: 'string' }),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).default(sql`CURRENT_TIMESTAMP`),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => [
	index("idx_ai_model_runs_form").using("btree", table.formId.asc().nullsLast().op("int4_ops"), table.startedAt.desc().nullsFirst().op("int4_ops")),
	foreignKey({
			columns: [table.formId],
			foreignColumns: [forms.id],
			name: "fk_model_run_form"
		}).onDelete("cascade"),
	check("chk_run_status", sql`(status)::text = ANY ((ARRAY['running'::character varying, 'completed'::character varying, 'failed'::character varying])::text[])`),
]);

export const formCollaborators = pgTable("form_collaborators", {
	id: serial().primaryKey().notNull(),
	formId: integer("form_id").notNull(),
	userId: integer("user_id"),
	email: varchar({ length: 255 }).notNull(),
	role: varchar({ length: 20 }).default('viewer').notNull(),
	invitedBy: integer("invited_by"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).default(sql`CURRENT_TIMESTAMP`),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => [
	index("idx_form_collaborators_email").using("btree", sql`lower((email)::text)`),
	index("idx_form_collaborators_user_id").using("btree", table.userId.asc().nullsLast().op("int4_ops")),
	uniqueIndex("uq_form_collaborator_email").using("btree", sql`form_id`, sql`lower((email)::text)`),
	foreignKey({
			columns: [table.formId],
			foreignColumns: [forms.id],
			name: "fk_collaborator_form"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.invitedBy],
			foreignColumns: [users.id],
			name: "fk_collaborator_inviter"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "fk_collaborator_user"
		}).onDelete("set null"),
	check("chk_collaborator_role", sql`(role)::text = 'viewer'::text`),
]);

export const points = pgTable("points", {
	id: serial().primaryKey().notNull(),
	answerId: integer("answer_id").notNull(),
	canonicalTopicId: integer("canonical_topic_id"),
	pointText: text("point_text").notNull(),
	embedding: vector({ dimensions: 384 }),
	sentimentLabel: varchar("sentiment_label", { length: 20 }),
	isViolation: boolean("is_violation"),
	assignmentConfidence: real("assignment_confidence"),
	processingStatus: varchar("processing_status", { length: 20 }).default('pending').notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).default(sql`CURRENT_TIMESTAMP`),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).default(sql`CURRENT_TIMESTAMP`).notNull(),
	violationStatus: varchar("violation_status", { length: 20 }),
	violationReviewedBy: integer("violation_reviewed_by"),
	violationReviewedAt: timestamp("violation_reviewed_at", { withTimezone: true, mode: 'string' }),
	violationType: varchar("violation_type", { length: 20 }),
}, (table) => [
	index("idx_points_answer_id").using("btree", table.answerId.asc().nullsLast().op("int4_ops")),
	index("idx_points_pending").using("btree", table.id.asc().nullsLast().op("int4_ops")).where(sql`((processing_status)::text = 'pending'::text)`),
	index("idx_points_topic").using("btree", table.canonicalTopicId.asc().nullsLast().op("int4_ops")).where(sql`(canonical_topic_id IS NOT NULL)`),
	foreignKey({
			columns: [table.answerId],
			foreignColumns: [answers.id],
			name: "fk_point_answer"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.canonicalTopicId],
			foreignColumns: [canonicalTopics.id],
			name: "fk_point_topic"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.violationReviewedBy],
			foreignColumns: [users.id],
			name: "points_violation_reviewed_by_fkey"
		}).onDelete("set null"),
	check("chk_sentiment", sql`(sentiment_label)::text = ANY ((ARRAY['positive'::character varying, 'neutral'::character varying, 'negative'::character varying])::text[])`),
	check("chk_processing", sql`(processing_status)::text = ANY (ARRAY[('pending'::character varying)::text, ('assigned'::character varying)::text, ('unknown'::character varying)::text, ('clustered'::character varying)::text])`),
	check("chk_status_topic", sql`((processing_status)::text = 'assigned'::text) = (canonical_topic_id IS NOT NULL)`),
	check("chk_labels_together", sql`(sentiment_label IS NULL) = (is_violation IS NULL)`),
	check("chk_violation_status", sql`(violation_status)::text = ANY ((ARRAY['none'::character varying, 'possible'::character varying, 'violation'::character varying, 'confirmed'::character varying, 'dismissed'::character varying])::text[])`),
	check("chk_violation_type", sql`(violation_type)::text = ANY ((ARRAY['none'::character varying, 'legal'::character varying, 'moral'::character varying, 'ethics'::character varying])::text[])`),
]);

export const formOpens = pgTable("form_opens", {
	userId: integer("user_id").notNull(),
	formId: integer("form_id").notNull(),
	openedAt: timestamp("opened_at", { withTimezone: true, mode: 'string' }).default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => [
	index("idx_form_opens_user_recent").using("btree", table.userId.asc().nullsLast().op("int4_ops"), table.openedAt.desc().nullsFirst().op("int4_ops")),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "fk_open_user"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.formId],
			foreignColumns: [forms.id],
			name: "fk_open_form"
		}).onDelete("cascade"),
	primaryKey({ columns: [table.formId, table.userId], name: "form_opens_pkey"}),
]);
