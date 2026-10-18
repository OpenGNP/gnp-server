import { relations } from "drizzle-orm/relations";
import { organizations, users, forms, formFields, folders, fieldOptions, submissions, answers, canonicalTopics, formAllowedUsers, points, aiModelRuns, formCollaborators, formOpens } from "./schema";

export const usersRelations = relations(users, ({one, many}) => ({
	organization: one(organizations, {
		fields: [users.organizationId],
		references: [organizations.id]
	}),
	forms: many(forms),
	folders: many(folders),
	submissions: many(submissions),
	formAllowedUsers: many(formAllowedUsers),
	formCollaborators_userId: many(formCollaborators, {
		relationName: "formCollaborators_userId_users_id"
	}),
	formCollaborators_invitedBy: many(formCollaborators, {
		relationName: "formCollaborators_invitedBy_users_id"
	}),
	formOpens: many(formOpens),
}));

export const organizationsRelations = relations(organizations, ({many}) => ({
	users: many(users),
	forms: many(forms),
}));

export const formFieldsRelations = relations(formFields, ({one, many}) => ({
	form: one(forms, {
		fields: [formFields.formId],
		references: [forms.id]
	}),
	fieldOptions: many(fieldOptions),
	answers: many(answers),
}));

export const formsRelations = relations(forms, ({one, many}) => ({
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
	submissions: many(submissions),
	canonicalTopics: many(canonicalTopics),
	formAllowedUsers: many(formAllowedUsers),
	aiModelRuns: many(aiModelRuns),
	formCollaborators: many(formCollaborators),
	formOpens: many(formOpens),
}));

export const foldersRelations = relations(folders, ({one, many}) => ({
	forms: many(forms),
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
}));

export const fieldOptionsRelations = relations(fieldOptions, ({one, many}) => ({
	formField: one(formFields, {
		fields: [fieldOptions.fieldId],
		references: [formFields.id]
	}),
	answers: many(answers),
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

export const canonicalTopicsRelations = relations(canonicalTopics, ({one, many}) => ({
	form: one(forms, {
		fields: [canonicalTopics.formId],
		references: [forms.id]
	}),
	points: many(points),
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

export const aiModelRunsRelations = relations(aiModelRuns, ({one}) => ({
	form: one(forms, {
		fields: [aiModelRuns.formId],
		references: [forms.id]
	}),
}));

export const formCollaboratorsRelations = relations(formCollaborators, ({one}) => ({
	form: one(forms, {
		fields: [formCollaborators.formId],
		references: [forms.id]
	}),
	user_userId: one(users, {
		fields: [formCollaborators.userId],
		references: [users.id],
		relationName: "formCollaborators_userId_users_id"
	}),
	user_invitedBy: one(users, {
		fields: [formCollaborators.invitedBy],
		references: [users.id],
		relationName: "formCollaborators_invitedBy_users_id"
	}),
}));

export const formOpensRelations = relations(formOpens, ({one}) => ({
	user: one(users, {
		fields: [formOpens.userId],
		references: [users.id]
	}),
	form: one(forms, {
		fields: [formOpens.formId],
		references: [forms.id]
	}),
}));