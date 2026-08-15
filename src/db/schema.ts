import { pgTable, foreignKey, serial, integer, text, timestamp, vector, varchar, boolean, real } from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"



export const answers = pgTable("answers", {
	id: serial().notNull(),
	submissionId: integer("submission_id").notNull(),
	fieldId: integer("field_id").notNull(),
	answerText: text("answer_text"),
	answerOptionId: integer("answer_option_id"),
	createdAt: timestamp("created_at", { mode: 'string' }),
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

export const topicTrends = pgTable("topic_trends", {
	id: serial().notNull(),
	canonicalTopicId: integer("canonical_topic_id").notNull(),
	periodStart: timestamp("period_start", { mode: 'string' }),
	periodEnd: timestamp("period_end", { mode: 'string' }),
	feedbackCount: integer("feedback_count"),
	positiveCount: integer("positive_count"),
	neutralCount: integer("neutral_count"),
	negativeCount: integer("negative_count"),
	severeCount: integer("severe_count"),
	createdAt: timestamp("created_at", { mode: 'string' }),
}, (table) => [
	foreignKey({
			columns: [table.canonicalTopicId],
			foreignColumns: [canonicalTopics.id],
			name: "fk_topic_trend"
		}).onDelete("cascade"),
]);

export const points = pgTable("points", {
	id: serial().notNull(),
	answerId: integer("answer_id").notNull(),
	canonicalTopicId: integer("canonical_topic_id"),
	pointText: text("point_text"),
	embedding: vector({ dimensions: 1536 }),
	sentimentLabel: varchar("sentiment_label", { length: 20 }),
	isSevere: boolean("is_severe"),
	assignmentConfidence: real("assignment_confidence"),
	processingStatus: varchar("processing_status", { length: 30 }),
	createdAt: timestamp("created_at", { mode: 'string' }),
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

export const canonicalTopics = pgTable("canonical_topics", {
	id: serial().notNull(),
	canonicalName: varchar("canonical_name", { length: 255 }),
	canonicalSummary: text("canonical_summary"),
	representativeKeywords: text("representative_keywords"),
	centroidVector: vector("centroid_vector", { dimensions: 1536 }),
	topicSize: integer("topic_size"),
	status: varchar({ length: 20 }),
	firstDetectedAt: timestamp("first_detected_at", { mode: 'string' }),
	lastUpdatedAt: timestamp("last_updated_at", { mode: 'string' }),
	createdAt: timestamp("created_at", { mode: 'string' }),
});

export const topicVersions = pgTable("topic_versions", {
	id: serial().notNull(),
	canonicalTopicId: integer("canonical_topic_id").notNull(),
	generatedTitle: varchar("generated_title", { length: 255 }),
	generatedSummary: text("generated_summary"),
	representativeKeywords: text("representative_keywords"),
	modelVersion: varchar("model_version", { length: 100 }),
	createdAt: timestamp("created_at", { mode: 'string' }),
}, (table) => [
	foreignKey({
			columns: [table.canonicalTopicId],
			foreignColumns: [canonicalTopics.id],
			name: "fk_topic_version"
		}).onDelete("cascade"),
]);

export const unassignedPoints = pgTable("unassigned_points", {
	id: serial().notNull(),
	pointId: integer("point_id").notNull(),
	embedding: vector({ dimensions: 1536 }),
	reason: varchar({ length: 100 }),
	createdAt: timestamp("created_at", { mode: 'string' }),
}, (table) => [
	foreignKey({
			columns: [table.pointId],
			foreignColumns: [points.id],
			name: "fk_unassigned_point"
		}).onDelete("cascade"),
]);

export const aiModelRuns = pgTable("ai_model_runs", {
	id: serial().notNull(),
	modelName: varchar("model_name", { length: 100 }),
	modelVersion: varchar("model_version", { length: 100 }),
	embeddingModel: varchar("embedding_model", { length: 100 }),
	clusteringAlgorithm: varchar("clustering_algorithm", { length: 100 }),
	parameters: text(),
	startedAt: timestamp("started_at", { mode: 'string' }),
	completedAt: timestamp("completed_at", { mode: 'string' }),
});

export const organizations = pgTable("organizations", {
	id: serial().notNull(),
	organizationName: varchar("organization_name", { length: 255 }),
	organizationDomain: varchar("organization_domain", { length: 255 }),
	createdAt: timestamp("created_at", { mode: 'string' }),
});

export const users = pgTable("users", {
	id: serial().notNull(),
	fullName: varchar("full_name", { length: 255 }),
	email: varchar({ length: 255 }).notNull(),
	password: varchar({ length: 255 }),
	role: varchar({ length: 50 }),
	organizationId: integer("organization_id"),
	createdAt: timestamp("created_at", { mode: 'string' }),
}, (table) => [
	foreignKey({
			columns: [table.organizationId],
			foreignColumns: [organizations.id],
			name: "fk_user_organization"
		}).onDelete("set null"),
]);

export const folders = pgTable("folders", {
	id: serial().notNull(),
	adminId: integer("admin_id").notNull(),
	folderName: varchar("folder_name", { length: 255 }),
	folderDescription: text("folder_description"),
	createdAt: timestamp("created_at", { mode: 'string' }),
}, (table) => [
	foreignKey({
			columns: [table.adminId],
			foreignColumns: [users.id],
			name: "fk_folder_admin"
		}).onDelete("cascade"),
]);

export const forms = pgTable("forms", {
	id: serial().notNull(),
	adminId: integer("admin_id").notNull(),
	folderId: integer("folder_id"),
	formTitle: varchar("form_title", { length: 255 }),
	formDescription: text("form_description"),
	status: varchar({ length: 20 }),
	accessType: varchar("access_type", { length: 30 }),
	recordName: boolean("record_name"),
	oneResponsePerPerson: boolean("one_response_per_person"),
	organizationId: integer("organization_id"),
	startDate: timestamp("start_date", { mode: 'string' }),
	endDate: timestamp("end_date", { mode: 'string' }),
	createdAt: timestamp("created_at", { mode: 'string' }),
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
]);

export const formAllowedUsers = pgTable("form_allowed_users", {
	id: serial().notNull(),
	formId: integer("form_id").notNull(),
	userId: integer("user_id").notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }),
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

export const formFields = pgTable("form_fields", {
	id: serial().notNull(),
	formId: integer("form_id").notNull(),
	fieldLabel: varchar("field_label", { length: 255 }),
	fieldType: varchar("field_type", { length: 30 }),
	isRequired: boolean("is_required"),
	fieldOrder: integer("field_order"),
	createdAt: timestamp("created_at", { mode: 'string' }),
}, (table) => [
	foreignKey({
			columns: [table.formId],
			foreignColumns: [forms.id],
			name: "fk_field_form"
		}).onDelete("cascade"),
]);

export const fieldOptions = pgTable("field_options", {
	id: serial().notNull(),
	fieldId: integer("field_id").notNull(),
	optionLabel: varchar("option_label", { length: 255 }),
	optionValue: varchar("option_value", { length: 255 }),
	optionOrder: integer("option_order"),
	createdAt: timestamp("created_at", { mode: 'string' }),
}, (table) => [
	foreignKey({
			columns: [table.fieldId],
			foreignColumns: [formFields.id],
			name: "fk_option_field"
		}).onDelete("cascade"),
]);

export const submissions = pgTable("submissions", {
	id: serial().notNull(),
	formId: integer("form_id").notNull(),
	userId: integer("user_id"),
	anonymousCode: varchar("anonymous_code", { length: 100 }),
	submissionStatus: varchar("submission_status", { length: 30 }),
	createdAt: timestamp("created_at", { mode: 'string' }),
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
