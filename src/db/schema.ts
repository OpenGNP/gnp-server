import { pgTable, serial, varchar, timestamp, index, foreignKey, check, integer, boolean, uniqueIndex, text, uuid, vector, real } from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"



export const organizations = pgTable("organizations", {
	id: serial().notNull(),
	organizationName: varchar("organization_name", { length: 255 }),
	organizationDomain: varchar("organization_domain", { length: 255 }),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).default(sql`CURRENT_TIMESTAMP`),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const users = pgTable("users", {
	id: serial().notNull(),
	fullName: varchar("full_name", { length: 255 }),
	email: varchar({ length: 255 }).notNull(),
	password: varchar({ length: 255 }),
	role: varchar({ length: 50 }),
	organizationId: integer("organization_id"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).default(sql`CURRENT_TIMESTAMP`),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => [
	index("idx_users_organization_id").using("btree", table.organizationId.asc().nullsLast().op("int4_ops")),
	foreignKey({
			columns: [table.organizationId],
			foreignColumns: [organizations.id],
			name: "fk_user_organization"
		}).onDelete("set null"),
	check("chk_role", sql`(role)::text = ANY ((ARRAY['user'::character varying, 'staff'::character varying, 'admin'::character varying, 'superadmin'::character varying])::text[])`),
]);

export const formFields = pgTable("form_fields", {
	id: serial().notNull(),
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

export const folders = pgTable("folders", {
	id: serial().notNull(),
	adminId: integer("admin_id").notNull(),
	parentFolderId: integer("parent_folder_id"),
	folderName: varchar("folder_name", { length: 255 }),
	folderDescription: text("folder_description"),
	sortOrder: integer("sort_order").default(0).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).default(sql`CURRENT_TIMESTAMP`),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => [
	index("idx_folders_admin_id").using("btree", table.adminId.asc().nullsLast().op("int4_ops")),
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

export const forms = pgTable("forms", {
	id: serial().notNull(),
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
	slug: varchar({ length: 255 }),
	accessType: varchar("access_type", { length: 30 }).default('organization').notNull(),
	recordName: boolean("record_name").default(false),
	oneResponsePerPerson: boolean("one_response_per_person").default(false),
	sortOrder: integer("sort_order").default(0).notNull(),
	startDate: timestamp("start_date", { withTimezone: true, mode: 'string' }),
	endDate: timestamp("end_date", { withTimezone: true, mode: 'string' }),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).default(sql`CURRENT_TIMESTAMP`),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => [
	index("idx_forms_admin_id").using("btree", table.adminId.asc().nullsLast().op("int4_ops")),
	index("idx_forms_folder_id").using("btree", table.folderId.asc().nullsLast().op("int4_ops")),
	index("idx_forms_organization_id").using("btree", table.organizationId.asc().nullsLast().op("int4_ops")),
	index("idx_forms_status").using("btree", table.status.asc().nullsLast().op("text_ops")),
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
	check("chk_form_status", sql`(status)::text = ANY ((ARRAY['draft'::character varying, 'active'::character varying, 'closed'::character varying, 'archived'::character varying])::text[])`),
	check("chk_access_type", sql`(access_type)::text = ANY ((ARRAY['public'::character varying, 'organization'::character varying, 'specific'::character varying])::text[])`),
]);

export const fieldOptions = pgTable("field_options", {
	id: serial().notNull(),
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

export const answers = pgTable("answers", {
	id: serial().notNull(),
	submissionId: integer("submission_id").notNull(),
	fieldId: integer("field_id").notNull(),
	answerText: text("answer_text"),
	answerOptionId: integer("answer_option_id"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).default(sql`CURRENT_TIMESTAMP`),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => [
	index("idx_answers_answer_option_id").using("btree", table.answerOptionId.asc().nullsLast().op("int4_ops")),
	index("idx_answers_field_id").using("btree", table.fieldId.asc().nullsLast().op("int4_ops")),
	index("idx_answers_submission_id").using("btree", table.submissionId.asc().nullsLast().op("int4_ops")),
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

export const submissions = pgTable("submissions", {
	id: serial().notNull(),
	formId: integer("form_id").notNull(),
	userId: integer("user_id"),
	anonymousCode: varchar("anonymous_code", { length: 100 }),
	respondentName: varchar("respondent_name", { length: 255 }),
	submissionStatus: varchar("submission_status", { length: 30 }).default('submitted'),
	aiAttempts: integer("ai_attempts").default(0).notNull(),
	aiError: text("ai_error"),
	processingStartedAt: timestamp("processing_started_at", { withTimezone: true, mode: 'string' }),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).default(sql`CURRENT_TIMESTAMP`),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => [
	index("idx_submissions_ai_queue").using("btree", table.createdAt.asc().nullsLast().op("timestamptz_ops")).where(sql`((submission_status)::text = ANY ((ARRAY['submitted'::character varying, 'processing'::character varying])::text[]))`),
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

export const canonicalTopics = pgTable("canonical_topics", {
	id: serial().notNull(),
	formId: integer("form_id"),
	fieldId: integer("field_id"),
	mergedIntoId: integer("merged_into_id"),
	canonicalName: varchar("canonical_name", { length: 255 }),
	canonicalSummary: text("canonical_summary"),
	representativeKeywords: text("representative_keywords"),
	centroidVector: vector("centroid_vector", { dimensions: 384 }),
	topicSize: integer("topic_size"),
	status: varchar({ length: 20 }),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).default(sql`CURRENT_TIMESTAMP`),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => [
	index("idx_canonical_topics_centroid_hnsw").using("hnsw", table.centroidVector.asc().nullsLast().op("vector_cosine_ops")),
	index("idx_canonical_topics_form_status").using("btree", table.formId.asc().nullsLast().op("int4_ops"), table.status.asc().nullsLast().op("int4_ops")),
	foreignKey({
			columns: [table.formId],
			foreignColumns: [forms.id],
			name: "fk_topic_form"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.fieldId],
			foreignColumns: [formFields.id],
			name: "fk_topic_field"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.mergedIntoId],
			foreignColumns: [table.id],
			name: "fk_topic_merged_into"
		}).onDelete("set null"),
	check("chk_topic_status", sql`(status)::text = ANY ((ARRAY['active'::character varying, 'merged'::character varying, 'archived'::character varying])::text[])`),
]);

export const points = pgTable("points", {
	id: serial().notNull(),
	answerId: integer("answer_id").notNull(),
	canonicalTopicId: integer("canonical_topic_id"),
	pointText: text("point_text"),
	embedding: vector({ dimensions: 384 }),
	sentimentLabel: varchar("sentiment_label", { length: 20 }),
	isSevere: boolean("is_severe").default(false),
	assignmentConfidence: real("assignment_confidence"),
	processingStatus: varchar("processing_status", { length: 30 }),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).default(sql`CURRENT_TIMESTAMP`),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => [
	index("idx_points_answer_id").using("btree", table.answerId.asc().nullsLast().op("int4_ops")),
	index("idx_points_canonical_topic_id").using("btree", table.canonicalTopicId.asc().nullsLast().op("int4_ops")),
	index("idx_points_embedding_hnsw").using("hnsw", table.embedding.asc().nullsLast().op("vector_cosine_ops")),
	index("idx_points_processing_status").using("btree", table.processingStatus.asc().nullsLast().op("text_ops")),
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
	check("chk_sentiment", sql`(sentiment_label)::text = ANY ((ARRAY['positive'::character varying, 'neutral'::character varying, 'negative'::character varying])::text[])`),
	check("chk_processing", sql`(processing_status)::text = ANY ((ARRAY['pending'::character varying, 'assigned'::character varying, 'unknown'::character varying, 'clustered'::character varying])::text[])`),
]);

export const aiModelRuns = pgTable("ai_model_runs", {
	id: serial().notNull(),
	formId: integer("form_id"),
	modelName: varchar("model_name", { length: 100 }),
	modelVersion: varchar("model_version", { length: 100 }),
	embeddingModel: varchar("embedding_model", { length: 100 }),
	clusteringAlgorithm: varchar("clustering_algorithm", { length: 100 }),
	parameters: text(),
	status: varchar({ length: 20 }),
	error: text(),
	startedAt: timestamp("started_at", { withTimezone: true, mode: 'string' }),
	completedAt: timestamp("completed_at", { withTimezone: true, mode: 'string' }),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).default(sql`CURRENT_TIMESTAMP`),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => [
	foreignKey({
			columns: [table.formId],
			foreignColumns: [forms.id],
			name: "fk_model_run_form"
		}).onDelete("cascade"),
]);

export const formAllowedUsers = pgTable("form_allowed_users", {
	id: serial().notNull(),
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
		}).onDelete("cascade"),
]);
