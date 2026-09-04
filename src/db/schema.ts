import { pgSchema, foreignKey, unique, serial, integer, text, timestamp, vector, varchar, uuid, boolean, real } from "drizzle-orm/pg-core"

const nowIso = () => new Date().toISOString()

// All application tables live in the `test` Postgres schema on the shared KMUTT
// database (drizzle.config.ts `schemaFilter` matches). Everything reached through
// these table objects — the app in db/client.ts and the seed script alike — is
// automatically qualified as "test"."<table>".
export const test = pgSchema("test");

export const answers = test.table("answers", {
	id: serial().primaryKey(),
	submissionId: integer("submission_id").notNull(),
	fieldId: integer("field_id").notNull(),
	answerText: text("answer_text"),
	answerOptionId: integer("answer_option_id"),
	createdAt: timestamp("created_at", { mode: 'string' }).$defaultFn(nowIso),
}, (table) => [
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

export const topicTrends = test.table("topic_trends", {
	id: serial().primaryKey(),
	canonicalTopicId: integer("canonical_topic_id").notNull(),
	periodStart: timestamp("period_start", { mode: 'string' }),
	periodEnd: timestamp("period_end", { mode: 'string' }),
	feedbackCount: integer("feedback_count"),
	positiveCount: integer("positive_count"),
	neutralCount: integer("neutral_count"),
	negativeCount: integer("negative_count"),
	severeCount: integer("severe_count"),
	createdAt: timestamp("created_at", { mode: 'string' }).$defaultFn(nowIso),
}, (table) => [
	foreignKey({
			columns: [table.canonicalTopicId],
			foreignColumns: [canonicalTopics.id],
			name: "fk_topic_trend"
		}).onDelete("cascade"),
]);

export const points = test.table("points", {
	id: serial().primaryKey(),
	answerId: integer("answer_id").notNull(),
	canonicalTopicId: integer("canonical_topic_id"),
	pointText: text("point_text"),
	embedding: vector({ dimensions: 1536 }),
	sentimentLabel: varchar("sentiment_label", { length: 20 }),
	isSevere: boolean("is_severe").default(false),
	assignmentConfidence: real("assignment_confidence"),
	processingStatus: varchar("processing_status", { length: 30 }),
	createdAt: timestamp("created_at", { mode: 'string' }).$defaultFn(nowIso),
}, (table) => [
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
]);

export const canonicalTopics = test.table("canonical_topics", {
	id: serial().primaryKey(),
	canonicalName: varchar("canonical_name", { length: 255 }),
	canonicalSummary: text("canonical_summary"),
	representativeKeywords: text("representative_keywords"),
	centroidVector: vector("centroid_vector", { dimensions: 1536 }),
	topicSize: integer("topic_size"),
	status: varchar({ length: 20 }),
	firstDetectedAt: timestamp("first_detected_at", { mode: 'string' }),
	lastUpdatedAt: timestamp("last_updated_at", { mode: 'string' }),
	createdAt: timestamp("created_at", { mode: 'string' }).$defaultFn(nowIso),
});

export const topicVersions = test.table("topic_versions", {
	id: serial().primaryKey(),
	canonicalTopicId: integer("canonical_topic_id").notNull(),
	generatedTitle: varchar("generated_title", { length: 255 }),
	generatedSummary: text("generated_summary"),
	representativeKeywords: text("representative_keywords"),
	modelVersion: varchar("model_version", { length: 100 }),
	createdAt: timestamp("created_at", { mode: 'string' }).$defaultFn(nowIso),
}, (table) => [
	foreignKey({
			columns: [table.canonicalTopicId],
			foreignColumns: [canonicalTopics.id],
			name: "fk_topic_version"
		}).onDelete("cascade"),
]);

export const unassignedPoints = test.table("unassigned_points", {
	id: serial().primaryKey(),
	pointId: integer("point_id").notNull(),
	embedding: vector({ dimensions: 1536 }),
	reason: varchar({ length: 100 }),
	createdAt: timestamp("created_at", { mode: 'string' }).$defaultFn(nowIso),
}, (table) => [
	foreignKey({
			columns: [table.pointId],
			foreignColumns: [points.id],
			name: "fk_unassigned_point"
		}).onDelete("cascade"),
	unique("unassigned_points_point_id_key").on(table.pointId),
]);

export const aiModelRuns = test.table("ai_model_runs", {
	id: serial().primaryKey(),
	modelName: varchar("model_name", { length: 100 }),
	modelVersion: varchar("model_version", { length: 100 }),
	embeddingModel: varchar("embedding_model", { length: 100 }),
	clusteringAlgorithm: varchar("clustering_algorithm", { length: 100 }),
	parameters: text(),
	startedAt: timestamp("started_at", { mode: 'string' }),
	completedAt: timestamp("completed_at", { mode: 'string' }),
});

export const organizations = test.table("organizations", {
	id: serial().primaryKey(),
	organizationName: varchar("organization_name", { length: 255 }),
	organizationDomain: varchar("organization_domain", { length: 255 }),
	createdAt: timestamp("created_at", { mode: 'string' }).$defaultFn(nowIso),
});

export const users = test.table("users", {
	id: serial().primaryKey(),
	fullName: varchar("full_name", { length: 255 }),
	email: varchar({ length: 255 }).notNull(),
	password: varchar({ length: 255 }),
	role: varchar({ length: 50 }),
	organizationId: integer("organization_id"),
	createdAt: timestamp("created_at", { mode: 'string' }).$defaultFn(nowIso),
}, (table) => [
	foreignKey({
			columns: [table.organizationId],
			foreignColumns: [organizations.id],
			name: "fk_user_organization"
		}).onDelete("set null"),
	unique("users_email_key").on(table.email),
]);

export const folders = test.table("folders", {
	id: serial().primaryKey(),
	adminId: integer("admin_id").notNull(),
	parentFolderId: integer("parent_folder_id"),
	folderName: varchar("folder_name", { length: 255 }),
	folderDescription: text("folder_description"),
	sortOrder: integer("sort_order").default(0).notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).$defaultFn(nowIso),
	updatedAt: timestamp("updated_at", { mode: 'string' }).notNull().$defaultFn(nowIso),
}, (table) => [
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

export const forms = test.table("forms", {
	id: serial().primaryKey(),
	adminId: integer("admin_id").notNull(),
	folderId: integer("folder_id"),
	organizationId: integer("organization_id"),
	formTitle: varchar("form_title", { length: 255 }),
	formDescription: text("form_description"),
	coverImageUrl: text("cover_image_url"),
	status: varchar({ length: 20 }).default("draft").notNull(),
	accessType: varchar("access_type", { length: 30 }).default("organization").notNull(),
	acceptingResponses: boolean("accepting_responses").default(true).notNull(),
	recordName: boolean("record_name").default(false),
	oneResponsePerPerson: boolean("one_response_per_person").default(false),
	publishedAt: timestamp("published_at", { mode: 'string' }),
	publicToken: uuid("public_token").defaultRandom().notNull(),
	slug: varchar({ length: 255 }),
	sortOrder: integer("sort_order").default(0).notNull(),
	startDate: timestamp("start_date", { mode: 'string' }),
	endDate: timestamp("end_date", { mode: 'string' }),
	createdAt: timestamp("created_at", { mode: 'string' }).$defaultFn(nowIso),
	updatedAt: timestamp("updated_at", { mode: 'string' }).notNull().$defaultFn(nowIso),
}, (table) => [
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
	unique("uq_form_slug").on(table.slug),
]);

export const formAllowedUsers = test.table("form_allowed_users", {
	id: serial().primaryKey(),
	formId: integer("form_id").notNull(),
	userId: integer("user_id").notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).$defaultFn(nowIso),
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
	unique("form_allowed_users_form_id_user_id_key").on(table.formId, table.userId),
]);

export const formFields = test.table("form_fields", {
	id: serial().primaryKey(),
	formId: integer("form_id").notNull(),
	fieldLabel: varchar("field_label", { length: 255 }),
	fieldType: varchar("field_type", { length: 30 }),
	section: varchar({ length: 20 }).default("feedback").notNull(),
	analyzeWithAi: boolean("analyze_with_ai").default(false).notNull(),
	allowOther: boolean("allow_other").default(false).notNull(),
	isRequired: boolean("is_required").default(false),
	fieldOrder: integer("field_order"),
	createdAt: timestamp("created_at", { mode: 'string' }).$defaultFn(nowIso),
	updatedAt: timestamp("updated_at", { mode: 'string' }).notNull().$defaultFn(nowIso),
}, (table) => [
	foreignKey({
			columns: [table.formId],
			foreignColumns: [forms.id],
			name: "fk_field_form"
		}).onDelete("cascade"),
]);

export const fieldOptions = test.table("field_options", {
	id: serial().primaryKey(),
	fieldId: integer("field_id").notNull(),
	optionLabel: varchar("option_label", { length: 255 }),
	optionValue: varchar("option_value", { length: 255 }),
	optionOrder: integer("option_order"),
	createdAt: timestamp("created_at", { mode: 'string' }).$defaultFn(nowIso),
}, (table) => [
	foreignKey({
			columns: [table.fieldId],
			foreignColumns: [formFields.id],
			name: "fk_option_field"
		}).onDelete("cascade"),
]);

export const submissions = test.table("submissions", {
	id: serial().primaryKey(),
	formId: integer("form_id").notNull(),
	userId: integer("user_id"),
	anonymousCode: varchar("anonymous_code", { length: 100 }),
	respondentName: varchar("respondent_name", { length: 255 }),
	submissionStatus: varchar("submission_status", { length: 30 }),
	createdAt: timestamp("created_at", { mode: 'string' }).$defaultFn(nowIso),
}, (table) => [
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
]);
