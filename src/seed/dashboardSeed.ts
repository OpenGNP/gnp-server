/**
 * Dashboard seed — additive.
 *
 * Creates ONE rich form ("SIT Student Experience Survey 2026") with a mix of field
 * types + ~55 generated submissions, so the Dashboard's Response tab has real data
 * (demographic pies, a multi-choice bar, free-text response lists). It also tags each
 * text answer with a sentiment + canonical topic and writes topic-trend rows, so the
 * later Themes / Trend work has something to read too.
 *
 * Unlike src/seed/seed.ts this does NOT wipe every table — it upserts the org/admin/
 * topics and replaces just its own form. Run:  bun run src/seed/dashboardSeed.ts
 */
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { env } from "../config/env";
import {
  answers,
  canonicalTopics,
  fieldOptions,
  folders,
  formFields,
  forms,
  organizations,
  points,
  submissions,
  topicTrends,
  users,
} from "../db/schema";
import { hashPassword } from "../utils/password";

const client = postgres(env.DATABASE_URL);
const db = drizzle(client);

const FORM_TITLE = "SIT Student Experience Survey 2026";
const DAY_MS = 24 * 60 * 60 * 1000;
const daysAgo = (n: number) => new Date(Date.now() - n * DAY_MS).toISOString();
const slugify = (s: string) =>
  s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

async function one<T>(rows: Promise<T[]>): Promise<T> {
  const [row] = await rows;
  if (!row) throw new Error("Expected a row");
  return row;
}

function pick<T>(items: readonly T[]): T {
  return items[Math.floor(Math.random() * items.length)]!;
}

function weightedPick<T>(entries: readonly (readonly [T, number])[]): T {
  const total = entries.reduce((sum, [, weight]) => sum + weight, 0);
  let roll = Math.random() * total;
  for (const [value, weight] of entries) {
    roll -= weight;
    if (roll <= 0) return value;
  }
  return entries[entries.length - 1]![0];
}

function sample<T>(items: readonly T[], min: number, max: number): T[] {
  const count = min + Math.floor(Math.random() * (max - min + 1));
  return [...items].sort(() => Math.random() - 0.5).slice(0, count);
}

// --- Mock content ----------------------------------------------------------

type Weighted = readonly (readonly [string, number])[];

const PROGRAMS: Weighted = [
  ["Computer Science", 5],
  ["Information Technology", 3],
  ["Data Science", 3],
  ["International Program", 2],
];
const YEARS: Weighted = [
  ["Year 1", 4],
  ["Year 2", 3],
  ["Year 3", 3],
  ["Year 4", 2],
];
const GENDERS: Weighted = [
  ["Male", 6],
  ["Female", 4],
  ["Prefer not to say", 1],
];
const SATISFACTION: Weighted = [
  ["Very dissatisfied", 1],
  ["Dissatisfied", 2],
  ["Neutral", 4],
  ["Satisfied", 4],
  ["Very satisfied", 2],
];
const FACILITIES = [
  "Library",
  "Co-working space",
  "Computer labs",
  "Cafeteria",
  "Study rooms",
  "Gym",
] as const;

type Sentiment = "positive" | "neutral" | "negative";
type TextEntry = { text: string; sentiment: Sentiment; topic: string | null; severe?: boolean };

const TOPICS = [
  {
    name: "Curriculum & Course Content",
    summary:
      "Feedback about course relevance, difficulty progression, outdated material, and overlap between related subjects.",
    keywords: "curriculum, outdated courses, projects, industry, electives",
  },
  {
    name: "Communication & Coordination",
    summary:
      "Feedback about the platforms and responsiveness used for sharing assignments, announcements, and staff communication.",
    keywords: "LINE, Microsoft Teams, staff response, announcements",
  },
  {
    name: "Campus Facilities & Equipment",
    summary:
      "Feedback about classroom buildings, furniture, air conditioning, and co-working spaces.",
    keywords: "CB building, LX building, chairs, air conditioning, monitors",
  },
  {
    name: "IT Infrastructure & Network",
    summary: "Feedback about internet speed, WiFi reliability, and computer lab performance.",
    keywords: "internet speed, WiFi, lab computers, SIT-Secure",
  },
  {
    name: "Study Spaces & Availability",
    summary: "Feedback about how many study/quiet rooms exist and how hard they are to book.",
    keywords: "study rooms, booking, quiet space, exam period",
  },
  {
    name: "Food & Cafeteria",
    summary: "Feedback about cafeteria variety, price, queue times, and opening hours.",
    keywords: "cafeteria, food options, price, queue",
  },
] as const;

const CURRICULUM_RESPONSES: readonly TextEntry[] = [
  {
    text: "The core courses feel outdated compared to what the industry actually uses. I'd love the department to rebuild the syllabus with input from recent alumni working in the field, because a lot of what we spend weeks on in class gets replaced by a single afternoon of onboarding at a real job.",
    sentiment: "negative",
    topic: "Curriculum & Course Content",
  },
  {
    text: "I like the balance between theory and hands-on labs, but the pace in year 2 is far too fast and a lot of people fall behind.",
    sentiment: "neutral",
    topic: "Curriculum & Course Content",
  },
  {
    text: "More electives around AI, MLOps and data engineering would help a lot — right now there's basically one.",
    sentiment: "negative",
    topic: "Curriculum & Course Content",
  },
  {
    text: "Group projects are great and the capstone prepared me well for my internship. Keep those.",
    sentiment: "positive",
    topic: "Curriculum & Course Content",
  },
  {
    text: "Grading feels inconsistent between sections of the same course — two friends handed in similar work and got very different marks.",
    sentiment: "negative",
    topic: "Curriculum & Course Content",
  },
  {
    text: "Would love more feedback loops during the semester instead of only at the end when it's too late to improve.",
    sentiment: "neutral",
    topic: "Curriculum & Course Content",
  },
  {
    text: "The fundamentals (data structures, algorithms, OS) are solid and I'm glad they're mandatory.",
    sentiment: "positive",
    topic: "Curriculum & Course Content",
  },
  {
    text: "Too much overlap between the data visualization, big data and data mining courses — it's the same content three times.",
    sentiment: "negative",
    topic: "Curriculum & Course Content",
  },
  {
    text: "Communication from some instructors is only on LINE, which has no searchable history. Assignments should be on Teams or the LMS.",
    sentiment: "negative",
    topic: "Communication & Coordination",
  },
  {
    text: "Honestly the curriculum is fine, I just wish there were more project-based courses earlier on.",
    sentiment: "neutral",
    topic: "Curriculum & Course Content",
  },
];

const FACILITY_RESPONSES: readonly TextEntry[] = [
  {
    text: "Lab computers in the CB building are slow and a few of them won't even run Docker. They badly need an upgrade.",
    sentiment: "negative",
    topic: "IT Infrastructure & Network",
  },
  {
    text: "WiFi drops constantly in the CB2 classroom during peak hours — SIT-Secure sometimes doesn't even show up in the list.",
    sentiment: "negative",
    topic: "IT Infrastructure & Network",
  },
  {
    text: "Study rooms are great but there are never enough of them before exams. The booking system also lets people no-show with no penalty.",
    sentiment: "negative",
    topic: "Study Spaces & Availability",
  },
  {
    text: "Cafeteria food options have improved a lot this semester and the new vegetarian station is good.",
    sentiment: "positive",
    topic: "Food & Cafeteria",
  },
  {
    text: "Air conditioning in the main lecture hall is way too cold, everyone brings a jacket. In LX it's the opposite.",
    sentiment: "negative",
    topic: "Campus Facilities & Equipment",
  },
  {
    text: "The LX building is a big improvement over CB — better chairs, more plugs, cleaner. I wish more classes were held there.",
    sentiment: "positive",
    topic: "Campus Facilities & Equipment",
  },
  {
    text: "The co-working space needs better air circulation, it gets stuffy by the afternoon.",
    sentiment: "negative",
    topic: "Campus Facilities & Equipment",
  },
  {
    text: "Please add monitors to the common rooms so we can actually pair-program there.",
    sentiment: "neutral",
    topic: "Campus Facilities & Equipment",
  },
  {
    text: "Cafeteria queues at lunch are 15+ minutes and it closes too early for evening classes.",
    sentiment: "negative",
    topic: "Food & Cafeteria",
  },
  {
    text: "The library is quiet, well-lit and the staff are helpful. No complaints there.",
    sentiment: "positive",
    topic: "Study Spaces & Availability",
  },
  {
    text: "Old chairs and desks in CB can't hold a laptop and a notebook at the same time.",
    sentiment: "negative",
    topic: "Campus Facilities & Equipment",
  },
  {
    text: "Facilities are okay overall, just wish the gym had longer opening hours on weekends.",
    sentiment: "neutral",
    topic: "Campus Facilities & Equipment",
  },
];

// --- Seed ----------------------------------------------------------------

async function findOrCreateOrg() {
  const [existing] = await db
    .select()
    .from(organizations)
    .where(eq(organizations.organizationDomain, "sit.kmutt.ac.th"))
    .limit(1);
  if (existing) return existing;

  return one(
    db
      .insert(organizations)
      .values({
        organizationName: "King Mongkut's University of Technology Thonburi - SIT",
        organizationDomain: "sit.kmutt.ac.th",
        createdAt: daysAgo(200),
      })
      .returning(),
  );
}

async function findOrCreateAdmin(orgId: number) {
  const [existing] = await db
    .select()
    .from(users)
    .where(eq(users.email, "admin@sit.kmutt.ac.th"))
    .limit(1);
  if (existing) return existing;

  return one(
    db
      .insert(users)
      .values({
        fullName: "Admin User",
        email: "admin@sit.kmutt.ac.th",
        password: await hashPassword("mock-hashed-password"),
        role: "admin",
        organizationId: orgId,
        createdAt: daysAgo(200),
      })
      .returning(),
  );
}

async function findOrCreateFolder(adminId: number) {
  const [existing] = await db
    .select()
    .from(folders)
    .where(and(eq(folders.adminId, adminId), eq(folders.folderName, "SIT Focus Group")))
    .limit(1);
  if (existing) return existing;

  return one(
    db
      .insert(folders)
      .values({
        adminId,
        folderName: "SIT Focus Group",
        folderDescription: "Annual SIT student focus group feedback",
        sortOrder: 0,
        createdAt: daysAgo(200),
        updatedAt: daysAgo(200),
      })
      .returning(),
  );
}

async function findOrCreateTopics() {
  const byName = new Map<string, number>();
  for (const topic of TOPICS) {
    const [existing] = await db
      .select({ id: canonicalTopics.id })
      .from(canonicalTopics)
      .where(eq(canonicalTopics.canonicalName, topic.name))
      .limit(1);

    if (existing) {
      byName.set(topic.name, existing.id);
      continue;
    }

    const row = await one(
      db
        .insert(canonicalTopics)
        .values({
          canonicalName: topic.name,
          canonicalSummary: topic.summary,
          representativeKeywords: topic.keywords,
          topicSize: 0,
          status: "active",
          firstDetectedAt: daysAgo(120),
          lastUpdatedAt: daysAgo(0),
          createdAt: daysAgo(120),
        })
        .returning(),
    );
    byName.set(topic.name, row.id);
  }
  return byName;
}

async function main() {
  const org = await findOrCreateOrg();
  const admin = await findOrCreateAdmin(org.id);
  const folder = await findOrCreateFolder(admin.id);
  const topicIds = await findOrCreateTopics();

  // Replace any prior run of this form (cascades to its fields/options/submissions/answers/points).
  await db.delete(forms).where(and(eq(forms.adminId, admin.id), eq(forms.formTitle, FORM_TITLE)));

  const startDaysAgo = 60;
  const form = await one(
    db
      .insert(forms)
      .values({
        adminId: admin.id,
        folderId: folder.id,
        organizationId: org.id,
        formTitle: FORM_TITLE,
        formDescription: "How is your experience at SIT this semester?",
        status: "active",
        accessType: "organization",
        acceptingResponses: true,
        recordName: false,
        oneResponsePerPerson: true,
        publishedAt: daysAgo(startDaysAgo),
        slug: slugify(FORM_TITLE),
        sortOrder: 10,
        startDate: daysAgo(startDaysAgo),
        endDate: daysAgo(-30), // closes 30 days from now
        createdAt: daysAgo(startDaysAgo + 2),
        updatedAt: daysAgo(0),
      })
      .returning(),
  );

  // Fields --------------------------------------------------------------
  type ChoiceField = { id: number; optionIds: Map<string, number> };

  async function addChoiceField(
    label: string,
    section: "demographic" | "feedback",
    type: "radio" | "checkbox",
    order: number,
    optionLabels: readonly string[],
  ): Promise<ChoiceField> {
    const field = await one(
      db
        .insert(formFields)
        .values({
          formId: form.id,
          fieldLabel: label,
          fieldType: type,
          section,
          analyzeWithAi: false,
          allowOther: false,
          isRequired: section === "demographic",
          fieldOrder: order,
          createdAt: daysAgo(startDaysAgo),
          updatedAt: daysAgo(startDaysAgo),
        })
        .returning(),
    );

    const optionIds = new Map<string, number>();
    for (const [i, optionLabel] of optionLabels.entries()) {
      const opt = await one(
        db
          .insert(fieldOptions)
          .values({
            fieldId: field.id,
            optionLabel,
            optionValue: optionLabel,
            optionOrder: i + 1,
            createdAt: daysAgo(startDaysAgo),
          })
          .returning(),
      );
      optionIds.set(optionLabel, opt.id);
    }
    return { id: field.id, optionIds };
  }

  async function addTextField(label: string, order: number): Promise<number> {
    const field = await one(
      db
        .insert(formFields)
        .values({
          formId: form.id,
          fieldLabel: label,
          fieldType: "textarea",
          section: "feedback",
          analyzeWithAi: true,
          allowOther: false,
          isRequired: false,
          fieldOrder: order,
          createdAt: daysAgo(startDaysAgo),
          updatedAt: daysAgo(startDaysAgo),
        })
        .returning(),
    );
    return field.id;
  }

  const programField = await addChoiceField(
    "Program of study",
    "demographic",
    "radio",
    1,
    PROGRAMS.map(([label]) => label),
  );
  const yearField = await addChoiceField(
    "Year of study",
    "demographic",
    "radio",
    2,
    YEARS.map(([label]) => label),
  );
  const genderField = await addChoiceField(
    "Gender",
    "demographic",
    "radio",
    3,
    GENDERS.map(([label]) => label),
  );
  const satisfactionField = await addChoiceField(
    "Overall, how satisfied are you with SIT this semester?",
    "feedback",
    "radio",
    4,
    SATISFACTION.map(([label]) => label),
  );
  const facilitiesUsedField = await addChoiceField(
    "Which campus facilities do you use regularly?",
    "feedback",
    "checkbox",
    5,
    FACILITIES,
  );
  const curriculumField = await addTextField("What do you think about the current curriculum?", 6);
  const facilityField = await addTextField(
    "What would you like to share about campus facilities?",
    7,
  );

  // Submissions -------------------------------------------------------
  const RESPONSE_COUNT = 55;
  type PointSeed = { topicId: number; sentiment: Sentiment; severe: boolean };
  const allPoints: PointSeed[] = [];

  for (let i = 0; i < RESPONSE_COUNT; i += 1) {
    const submittedAt = daysAgo(Math.random() * startDaysAgo);
    const submission = await one(
      db
        .insert(submissions)
        .values({
          formId: form.id,
          anonymousCode: `SES-${String(i + 1).padStart(4, "0")}`,
          submissionStatus: "completed",
          createdAt: submittedAt,
        })
        .returning(),
    );

    const rows: (typeof answers.$inferInsert)[] = [
      {
        submissionId: submission.id,
        fieldId: programField.id,
        answerOptionId: programField.optionIds.get(weightedPick(PROGRAMS))!,
        createdAt: submittedAt,
      },
      {
        submissionId: submission.id,
        fieldId: yearField.id,
        answerOptionId: yearField.optionIds.get(weightedPick(YEARS))!,
        createdAt: submittedAt,
      },
      {
        submissionId: submission.id,
        fieldId: genderField.id,
        answerOptionId: genderField.optionIds.get(weightedPick(GENDERS))!,
        createdAt: submittedAt,
      },
      {
        submissionId: submission.id,
        fieldId: satisfactionField.id,
        answerOptionId: satisfactionField.optionIds.get(weightedPick(SATISFACTION))!,
        createdAt: submittedAt,
      },
    ];

    for (const facility of sample(FACILITIES, 1, 4)) {
      rows.push({
        submissionId: submission.id,
        fieldId: facilitiesUsedField.id,
        answerOptionId: facilitiesUsedField.optionIds.get(facility)!,
        createdAt: submittedAt,
      });
    }

    // Text answers — ~75% fill each textarea.
    const textFor = async (fieldId: number, pool: readonly TextEntry[]) => {
      if (Math.random() > 0.75) return;
      const entry = pick(pool);
      const answer = await one(
        db
          .insert(answers)
          .values({
            submissionId: submission.id,
            fieldId,
            answerText: entry.text,
            createdAt: submittedAt,
          })
          .returning(),
      );

      const topicId = entry.topic ? topicIds.get(entry.topic) : undefined;
      await db.insert(points).values({
        answerId: answer.id,
        canonicalTopicId: topicId ?? null,
        pointText: entry.text,
        sentimentLabel: entry.sentiment,
        isSevere: entry.severe ?? false,
        assignmentConfidence: topicId ? 0.7 + Math.random() * 0.29 : null,
        processingStatus: topicId ? "assigned" : "unknown",
        createdAt: submittedAt,
      });
      if (topicId) {
        allPoints.push({ topicId, sentiment: entry.sentiment, severe: entry.severe ?? false });
      }
    };

    await db.insert(answers).values(rows);
    await textFor(curriculumField, CURRICULUM_RESPONSES);
    await textFor(facilityField, FACILITY_RESPONSES);
  }

  // Topic sizes + one trend row per topic for this form's window.
  for (const topicId of topicIds.values()) {
    const topicPoints = allPoints.filter((p) => p.topicId === topicId);
    if (topicPoints.length === 0) continue;

    await db
      .update(canonicalTopics)
      .set({ topicSize: topicPoints.length, lastUpdatedAt: daysAgo(0) })
      .where(eq(canonicalTopics.id, topicId));

    await db.insert(topicTrends).values({
      canonicalTopicId: topicId,
      periodStart: daysAgo(startDaysAgo),
      periodEnd: daysAgo(0),
      feedbackCount: topicPoints.length,
      positiveCount: topicPoints.filter((p) => p.sentiment === "positive").length,
      neutralCount: topicPoints.filter((p) => p.sentiment === "neutral").length,
      negativeCount: topicPoints.filter((p) => p.sentiment === "negative").length,
      severeCount: topicPoints.filter((p) => p.severe).length,
      createdAt: daysAgo(0),
    });
  }

  console.log(
    `Dashboard seed complete: form #${form.id} "${FORM_TITLE}" with ${RESPONSE_COUNT} responses, ${allPoints.length} tagged points.`,
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await client.end();
  });
