import { relations } from "drizzle-orm/relations";
import { organizations, users, forms, submissions, answers, formFields, fieldOptions, points, canonicalTopics, folders, aiModelRuns, formAllowedUsers } from "./schema";

export const usersRelations = relations(users, ({one, many}) => ({
	organization: one(organizations, {
		fields: [users.organizationId],
		references: [organizations.id]
	}),
	submissions: many(submissions),
	folders: many(folders),
	forms: many(forms),
	formAllowedUsers: many(formAllowedUsers),
}));

export const organizationsRelations = relations(organizations, ({many}) => ({
	users: many(users),
	forms: many(forms),
}));

export const submissionsRelations = relations(submissions, ({one, many}) => ({
	form: one(forms, {
		fields: [submissions.formId],
		references: [forms.id]
	}),
	user: one(users, {
		fields: [submissions.userId],
		references: [users.id]
	}),
	answers: many(answers),
}));

export const formsRelations = relations(forms, ({one, many}) => ({
	submissions: many(submissions),
	aiModelRuns: many(aiModelRuns),
	formFields: many(formFields),
	user: one(users, {
		fields: [forms.adminId],
		references: [users.id]
	}),
	folder: one(folders, {
		fields: [forms.folderId],
		references: [folders.id]
	}),
	organization: one(organizations, {
		fields: [forms.organizationId],
		references: [organizations.id]
	}),
	formAllowedUsers: many(formAllowedUsers),
	canonicalTopics: many(canonicalTopics),
}));

export const answersRelations = relations(answers, ({one, many}) => ({
	submission: one(submissions, {
		fields: [answers.submissionId],
		references: [submissions.id]
	}),
	formField: one(formFields, {
		fields: [answers.fieldId],
		references: [formFields.id]
	}),
	fieldOption: one(fieldOptions, {
		fields: [answers.answerOptionId],
		references: [fieldOptions.id]
	}),
	points: many(points),
}));

export const formFieldsRelations = relations(formFields, ({one, many}) => ({
	answers: many(answers),
	form: one(forms, {
		fields: [formFields.formId],
		references: [forms.id]
	}),
	fieldOptions: many(fieldOptions),
	canonicalTopics: many(canonicalTopics),
}));

export const fieldOptionsRelations = relations(fieldOptions, ({one, many}) => ({
	answers: many(answers),
	formField: one(formFields, {
		fields: [fieldOptions.fieldId],
		references: [formFields.id]
	}),
}));

export const pointsRelations = relations(points, ({one}) => ({
	answer: one(answers, {
		fields: [points.answerId],
		references: [answers.id]
	}),
	canonicalTopic: one(canonicalTopics, {
		fields: [points.canonicalTopicId],
		references: [canonicalTopics.id]
	}),
}));

export const canonicalTopicsRelations = relations(canonicalTopics, ({one, many}) => ({
	points: many(points),
	form: one(forms, {
		fields: [canonicalTopics.formId],
		references: [forms.id]
	}),
	formField: one(formFields, {
		fields: [canonicalTopics.fieldId],
		references: [formFields.id]
	}),
	canonicalTopic: one(canonicalTopics, {
		fields: [canonicalTopics.mergedIntoId],
		references: [canonicalTopics.id],
		relationName: "canonicalTopics_mergedIntoId_canonicalTopics_id"
	}),
	canonicalTopics: many(canonicalTopics, {
		relationName: "canonicalTopics_mergedIntoId_canonicalTopics_id"
	}),
}));

export const foldersRelations = relations(folders, ({one, many}) => ({
	user: one(users, {
		fields: [folders.adminId],
		references: [users.id]
	}),
	folder: one(folders, {
		fields: [folders.parentFolderId],
		references: [folders.id],
		relationName: "folders_parentFolderId_folders_id"
	}),
	folders: many(folders, {
		relationName: "folders_parentFolderId_folders_id"
	}),
	forms: many(forms),
}));

export const aiModelRunsRelations = relations(aiModelRuns, ({one}) => ({
	form: one(forms, {
		fields: [aiModelRuns.formId],
		references: [forms.id]
	}),
}));

export const formAllowedUsersRelations = relations(formAllowedUsers, ({one}) => ({
	form: one(forms, {
		fields: [formAllowedUsers.formId],
		references: [forms.id]
	}),
	user: one(users, {
		fields: [formAllowedUsers.userId],
		references: [users.id]
	}),
}));