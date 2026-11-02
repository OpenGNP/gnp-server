/**
 * Demo seed: the public /demo's "Staff pulse survey" (src/services/demoForm.ts).
 *
 * Inserts 214 made-up responses (demoResponses.json) and NO analysis: the written answers
 * are left undecomposed, so the gnp-ai workers pick them up and the demo shows what our AI
 * really makes of them. Dates are kept from the JSON (Sep–Oct 2026) so Trend has a history.
 *
 * Replaces its own form on every run; touches nothing else. Run:  bun run seed:demo
 */
import { and, eq } from "drizzle-orm";

import {
  answers,
  db,
  fieldOptions,
  formFields,
  forms,
  queryClient,
  submissions,
  users,
} from "../db/client";
import { DEMO_FORM_TITLE, DEMO_OWNER_EMAIL } from "../services/demoForm";
import responses from "./demoResponses.json";

type DemoResponse = {
  submittedAt: string;
  name: string;
  department: string;
  shift: string;
  used: string[];
  text: string | null;
};

const DEPARTMENTS = ["Warehouse", "Customer service", "Finance", "Operations"];
const SHIFTS = ["Day", "Night"];
const USED = ["Shift swap form", "Payroll helpdesk", "Buddy scheme", "Staff car park"];

async function main() {
  const rows = responses as DemoResponse[];
  const first = rows.reduce((min, r) => (r.submittedAt < min ? r.submittedAt : min), rows[0]!.submittedAt);

  await db.transaction(async (tx) => {
    // No password and an .invalid address: an owner nobody can sign in as.
    let [owner] = await tx.select({ id: users.id }).from(users).where(eq(users.email, DEMO_OWNER_EMAIL)).limit(1);
    owner ??= (
      await tx.insert(users).values({ email: DEMO_OWNER_EMAIL, fullName: "OpenGNP demo", role: "user" }).returning({ id: users.id })
    )[0]!;

    // Cascades to its fields, submissions, answers, points and topics.
    await tx.delete(forms).where(and(eq(forms.adminId, owner.id), eq(forms.formTitle, DEMO_FORM_TITLE)));

    const [form] = await tx
      .insert(forms)
      .values({
        adminId: owner.id,
        formTitle: DEMO_FORM_TITLE,
        formDescription: "Tell us how this month went. Your answers help HR decide what to fix first.",
        status: "active",
        accessType: "public",
        // Shown, never answered: nobody can add to the demo's responses.
        acceptingResponses: false,
        recordName: true,
        publishedAt: first,
        startDate: first,
        createdAt: first,
      })
      .returning({ id: forms.id });

    const addField = async (
      label: string,
      type: "radio" | "checkbox" | "textarea",
      section: "demographic" | "feedback",
      order: number,
      options: string[] = [],
    ) => {
      const [field] = await tx
        .insert(formFields)
        .values({
          formId: form!.id,
          fieldLabel: label,
          fieldType: type,
          section,
          analyzeWithAi: type === "textarea",
          isRequired: section === "demographic",
          fieldOrder: order,
          createdAt: first,
        })
        .returning({ id: formFields.id });
      const optionIds = new Map<string, number>();
      if (options.length > 0) {
        const inserted = await tx
          .insert(fieldOptions)
          .values(options.map((label, i) => ({ fieldId: field!.id, optionLabel: label, optionValue: label, optionOrder: i + 1, createdAt: first })))
          .returning({ id: fieldOptions.id, label: fieldOptions.optionLabel });
        for (const option of inserted) optionIds.set(option.label!, option.id);
      }
      return { id: field!.id, optionIds };
    };

    const department = await addField("Department", "radio", "demographic", 1, DEPARTMENTS);
    const shift = await addField("Shift pattern", "radio", "demographic", 2, SHIFTS);
    const used = await addField("Which of these did you use this month?", "checkbox", "feedback", 3, USED);
    const comment = await addField("Anything else you'd like to tell us?", "textarea", "feedback", 4);

    const inserted = await tx
      .insert(submissions)
      .values(
        rows.map((r) => ({
          formId: form!.id,
          respondentName: r.name,
          submissionStatus: "completed",
          createdAt: r.submittedAt,
          updatedAt: r.submittedAt,
        })),
      )
      .returning({ id: submissions.id, createdAt: submissions.createdAt });
    if (inserted.length !== rows.length) throw new Error("Not every submission was inserted");

    const option = (field: { optionIds: Map<string, number> }, label: string) => {
      const id = field.optionIds.get(label);
      if (id === undefined) throw new Error(`Unknown option "${label}"`);
      return id;
    };
    await tx.insert(answers).values(
      rows.flatMap((r, i) => {
        const submissionId = inserted[i]!.id;
        const at = r.submittedAt;
        return [
          { submissionId, fieldId: department.id, answerOptionId: option(department, r.department), createdAt: at },
          { submissionId, fieldId: shift.id, answerOptionId: option(shift, r.shift), createdAt: at },
          ...r.used.map((label) => ({ submissionId, fieldId: used.id, answerOptionId: option(used, label), createdAt: at })),
          // decomposed_at stays null: this is the AI's queue.
          ...(r.text ? [{ submissionId, fieldId: comment.id, answerText: r.text, createdAt: at }] : []),
        ];
      }),
    );

    console.log(
      `Demo seed complete: form #${form!.id} "${DEMO_FORM_TITLE}" with ${rows.length} responses ` +
        `(${rows.filter((r) => r.text).length} written answers waiting for the AI).`,
    );
  });
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await queryClient.end();
  });
