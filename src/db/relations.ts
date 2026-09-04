import { relations } from "drizzle-orm/relations";
import { submissions, answers, formFields, fieldOptions, canonicalTopics, topicTrends, points, topicVersions, unassignedPoints, organizations, users, folders, forms, formAllowedUsers } from "./schema";

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

export const submissionsRelations = relations(submissions, ({one, many}) => ({
	answers: many(answers),
	form: one(forms, {
		fields: [submissions.formId],
		references: [forms.id]
	}),
	user: one(users, {
		fields: [submissions.userId],
		references: [users.id]
	}),
}));

export const formFieldsRelations = relations(formFields, ({one, many}) => ({
	answers: many(answers),
	form: one(forms, {
		fields: [formFields.formId],
		references: [forms.id]
	}),
	fieldOptions: many(fieldOptions),
}));

export const fieldOptionsRelations = relations(fieldOptions, ({one, many}) => ({
	answers: many(answers),
	formField: one(formFields, {
		fields: [fieldOptions.fieldId],
		references: [formFields.id]
	}),
}));

export const topicTrendsRelations = relations(topicTrends, ({one}) => ({
	canonicalTopic: one(canonicalTopics, {
		fields: [topicTrends.canonicalTopicId],
		references: [canonicalTopics.id]
	}),
}));

export const canonicalTopicsRelations = relations(canonicalTopics, ({many}) => ({
	topicTrends: many(topicTrends),
	points: many(points),
	topicVersions: many(topicVersions),
}));

export const pointsRelations = relations(points, ({one, many}) => ({
	answer: one(answers, {
		fields: [points.answerId],
		references: [answers.id]
	}),
	canonicalTopic: one(canonicalTopics, {
		fields: [points.canonicalTopicId],
		references: [canonicalTopics.id]
	}),
	unassignedPoints: many(unassignedPoints),
}));

export const topicVersionsRelations = relations(topicVersions, ({one}) => ({
	canonicalTopic: one(canonicalTopics, {
		fields: [topicVersions.canonicalTopicId],
		references: [canonicalTopics.id]
	}),
}));

export const unassignedPointsRelations = relations(unassignedPoints, ({one}) => ({
	point: one(points, {
		fields: [unassignedPoints.pointId],
		references: [points.id]
	}),
}));

export const usersRelations = relations(users, ({one, many}) => ({
	organization: one(organizations, {
		fields: [users.organizationId],
		references: [organizations.id]
	}),
	folders: many(folders),
	forms: many(forms),
	formAllowedUsers: many(formAllowedUsers),
	submissions: many(submissions),
}));

export const organizationsRelations = relations(organizations, ({many}) => ({
	users: many(users),
	forms: many(forms),
}));

export const foldersRelations = relations(folders, ({one, many}) => ({
	user: one(users, {
		fields: [folders.adminId],
		references: [users.id]
	}),
	parentFolder: one(folders, {
		fields: [folders.parentFolderId],
		references: [folders.id],
		relationName: "folder_parent"
	}),
	childFolders: many(folders, {
		relationName: "folder_parent"
	}),
	forms: many(forms),
}));

export const formsRelations = relations(forms, ({one, many}) => ({
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
	formFields: many(formFields),
	submissions: many(submissions),
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