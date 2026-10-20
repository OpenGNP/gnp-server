import {
  aiModelRuns,
  answers,
  canonicalTopics,
  db,
  fieldOptions,
  formFields,
  forms,
  points,
  submissions,
} from "../db/client";
import { createId } from "../utils/helper";

/*
 * The example form every new account starts with, already filled with made-up,
 * already "analysed" responses so the dashboard has something to show. Topics,
 * sentiment and violations are written directly: gnp-ai never sees them. The points
 * carry no embedding, which keeps them out of every clustering run (gnp-ai clusters
 * embedded points only), so these topics stay put even if real responses come later.
 */

export const GETTING_STARTED_TITLE = "Getting Started with OpenGNP";

const DESCRIPTION =
  "An example to explore, about campus services. Demographic questions describe who is answering, so you can filter and compare results. " +
  "Feedback questions collect opinions, and written answers there are grouped into topics by AI. " +
  "The responses here are made up. Edit it, reopen it, or delete it.";

type Sentiment = "positive" | "neutral" | "negative";
type TopicKey = keyof typeof TOPICS;
type Point = { topic: TopicKey | null; sentiment: Sentiment; text: string; violation?: boolean };

const ROLES = ["Student", "Staff", "Faculty"];
const TENURES = ["Less than 1 year", "1–3 years", "More than 3 years"];
const RATINGS = ["Very satisfied", "Satisfied", "Neutral", "Dissatisfied"];

// In form order. The last two are the written answers the sample's points belong to.
const FIELDS = [
  { fieldLabel: "What is your role?", fieldType: "radio", section: "demographic", isRequired: true, options: ROLES },
  { fieldLabel: "How long have you been here?", fieldType: "radio", section: "demographic", isRequired: true, options: TENURES },
  { fieldLabel: "How satisfied are you with campus services overall?", fieldType: "radio", section: "feedback", isRequired: true, options: RATINGS },
  { fieldLabel: "What works well on campus?", fieldType: "textarea", section: "feedback", analyzeWithAi: true },
  { fieldLabel: "What should we fix or improve?", fieldType: "textarea", section: "feedback", analyzeWithAi: true },
] as const;

// About services and places, never a person: the form is shown to everyone.
const TOPICS = {
  library: {
    name: "Quiet, well-equipped library",
    summary: "People value the library's study space, late opening hours and helpful service.",
    keywords: "library, study, quiet, seats, open late",
  },
  booking: {
    name: "Easy room booking",
    summary: "The online room booking system is quick and clear to use.",
    keywords: "booking, rooms, app, reserve, availability",
  },
  wifi: {
    name: "Unreliable Wi-Fi in teaching buildings",
    summary:
      "Mostly complaints that Wi-Fi drops or slows down in classrooms, more so around recent exams; " +
      "a few find it fine, or fast in the library.",
    keywords: "Wi-Fi, internet, connection, slow, classrooms",
  },
  canteen: {
    name: "Long canteen queues at lunchtime",
    summary: "The canteen is crowded at noon, with long queues and too few seats.",
    keywords: "canteen, queue, lunch, seats, food",
  },
  shuttle: {
    name: "Late and crowded campus shuttles",
    summary: "Shuttles run late, fill up in the morning and stop too early in the evening.",
    keywords: "shuttle, late, schedule, crowded, evening",
  },
  safety: {
    name: "Safety and privacy hazards",
    summary: "Reports of a blocked fire exit, personal data on public display and unlabelled lab chemicals.",
    keywords: "fire exit, personal data, chemicals, safety, privacy",
  },
} as const;

// Phrasings per code letter: L library, B booking, W Wi-Fi, F canteen (food), M shuttle
// (moving), C safety (flagged as violations), U uncategorised.
const PHRASES: Record<string, Point[]> = {
  L: [
    "The library is quiet and open late, which helps a lot during exams.",
    "Plenty of study seats and power outlets in the library.",
    "The library's online catalogue is easy to use.",
    "The library service desk is always helpful when I need a book.",
    "Group study rooms in the library are great for projects.",
    "I like the new self-checkout machines at the library.",
  ].map((text) => ({ topic: "library", sentiment: "positive", text })),
  B: [
    "Booking a meeting room through the app takes less than a minute.",
    "The room booking system shows availability clearly.",
    "It's easy to reserve a lab or classroom online.",
    "Room booking reminders are really useful.",
    "I can cancel bookings easily, so rooms don't sit empty.",
  ].map((text) => ({ topic: "booking", sentiment: "positive", text })),
  W: [
    "Wi-Fi keeps dropping in the teaching buildings.",
    "The internet is too slow to join online meetings from the classrooms.",
    "Wi-Fi in the lecture halls can't handle a full class.",
    "I lose connection every time I move between buildings.",
    "During exam week the Wi-Fi is almost unusable.",
    "We had to cancel an online quiz because the Wi-Fi went down.",
  ]
    .map((text): Point => ({ topic: "wifi", sentiment: "negative", text }))
    // Not all bad: the same topic can carry every sentiment.
    .concat([
      { topic: "wifi", sentiment: "positive", text: "Wi-Fi in the library is fast and reliable." },
      { topic: "wifi", sentiment: "neutral", text: "Wi-Fi is fine in most places but weaker on the top floors." },
      { topic: "wifi", sentiment: "positive", text: "Campus Wi-Fi got better after the new routers were installed." },
    ]),
  F: [
    "Canteen queues at lunchtime are far too long.",
    "There aren't enough seats in the canteen at noon.",
    "The lunch break is too short for the canteen queues.",
    "More food stalls would cut the waiting time at lunch.",
  ].map((text) => ({ topic: "canteen", sentiment: "negative", text })),
  M: [
    { topic: "shuttle", sentiment: "negative", text: "The campus shuttle is often 15 minutes late." },
    { topic: "shuttle", sentiment: "negative", text: "Shuttles are full in the morning, so I miss my first class." },
    { topic: "shuttle", sentiment: "negative", text: "There is no shuttle after 6 pm, which is hard for evening classes." },
    { topic: "shuttle", sentiment: "neutral", text: "It would help to see shuttle times in an app." },
  ],
  C: [
    "The fire exit on the 3rd floor is blocked by stored furniture.",
    "Student names and ID numbers were posted on a public notice board.",
    "Lab chemicals are stored in unlabelled bottles near the sink.",
  ].map((text) => ({ topic: "safety", sentiment: "negative", text, violation: true })),
  U: [
    "More bike parking near the main gate would help.",
    "The campus could use more drinking water stations.",
  ].map((text) => ({ topic: null, sentiment: "neutral", text })),
};

// [days ago, role, time here, rating, works well, to fix] — "W2" is PHRASES.W[2].
// Wi-Fi complaints cluster in recent weeks (exams) so Trend has something rising.
const RESPONSES: [number, number, number, number, string, string][] = [
  [1, 2, 0, 1, "L0", "W0"], [1, 1, 1, 2, "B0", "W1"], [2, 0, 0, 1, "L1", "W2 F0"],
  [3, 0, 2, 0, "L2 B1", ""], [4, 2, 1, 2, "", "W3"], [5, 1, 0, 1, "B2", "W4"],
  [6, 0, 2, 3, "", "W5 C0"], [7, 0, 0, 0, "L3", "M0"], [8, 2, 0, 1, "B3", "F1"],
  [9, 1, 2, 1, "L4", "W0"], [11, 0, 1, 2, "", "F2"], [12, 0, 1, 0, "L5 B4", ""],
  [13, 2, 2, 1, "B0", "M1 C2"], [15, 1, 0, 1, "L0", "U0"], [16, 0, 0, 2, "", "W1 F3"],
  [17, 0, 2, 1, "B1", "M2"], [19, 2, 1, 0, "L1 W6", ""], [20, 1, 1, 1, "B2", "F0"],
  [21, 0, 2, 3, "", "C1"], [23, 0, 0, 1, "L2", "M3 W7"], [24, 2, 0, 0, "L3 B3", ""],
  [26, 1, 2, 1, "", "W2"], [27, 0, 1, 1, "B4", "F1"], [29, 0, 1, 0, "L4 W8", ""],
  [30, 2, 2, 2, "", "F2 M0"], [32, 1, 0, 1, "L5", "U1"], [34, 0, 0, 1, "B0", "W3"],
  [35, 0, 2, 0, "L0 B2", ""], [37, 2, 1, 1, "", "M1 W7"], [38, 1, 1, 2, "", "F3"],
  [40, 0, 2, 1, "L1", "W4"], [41, 0, 0, 0, "B1", ""],
];

const pointsFor = (codes: string): Point[] =>
  codes
    .split(" ")
    .filter(Boolean)
    .map((code) => PHRASES[code[0]!]![Number(code.slice(1))]!);

/** The sample responses as plain data, newest first: choices by label, written answers as points. */
export function sampleResponses(now = new Date()) {
  return RESPONSES.map(([daysAgo, role, tenure, rating, worksWell, toFix], index) => {
    const at = new Date(now);
    at.setDate(at.getDate() - daysAgo);
    at.setHours(8 + ((index * 7) % 10), (index * 13) % 60, 0, 0);
    return {
      at: at.toISOString(),
      choices: [ROLES[role]!, TENURES[tenure]!, RATINGS[rating]!],
      written: [pointsFor(worksWell), pointsFor(toFix)],
    };
  });
}

type Owner = { id: number; organizationId: number | null };

/**
 * Creates the form and its sample in one transaction of eight bulk inserts (row by row
 * it was a couple of hundred round trips — too slow to sit in a first sign-in).
 */
async function insertGettingStartedForm(owner: Owner) {
  const sample = sampleResponses();
  const oldest = sample.at(-1)!.at;

  await db.transaction(async (tx) => {
    // A new account has no forms yet, so it's first (sort_order 0) at the top level.
    const [form] = await tx
      .insert(forms)
      .values({
        adminId: owner.id,
        organizationId: owner.organizationId,
        formTitle: GETTING_STARTED_TITLE,
        formDescription: DESCRIPTION,
        // Published once, not collecting now: what a form with responses usually is.
        status: "closed",
        acceptingResponses: false,
        publishedAt: oldest,
        // Personal accounts have no organization to limit it to.
        accessType: owner.organizationId === null ? "public" : "organization",
      })
      .returning({ id: forms.id });
    const formId = form!.id;

    const fieldRows = await tx
      .insert(formFields)
      .values(
        FIELDS.map((field, index) => ({
          formId,
          fieldLabel: field.fieldLabel,
          fieldType: field.fieldType,
          section: field.section,
          isRequired: "isRequired" in field ? field.isRequired : false,
          analyzeWithAi: "analyzeWithAi" in field ? field.analyzeWithAi : false,
          fieldOrder: index + 1,
        })),
      )
      .returning({ id: formFields.id, order: formFields.fieldOrder });
    const fieldIds = FIELDS.map((_, index) => fieldRows.find((row) => row.order === index + 1)!.id);

    const optionRows = await tx
      .insert(fieldOptions)
      .values(
        FIELDS.flatMap((field, fieldIndex) =>
          "options" in field
            ? field.options.map((label, optionIndex) => ({
                fieldId: fieldIds[fieldIndex]!,
                optionLabel: label,
                optionValue: label,
                optionOrder: optionIndex + 1,
              }))
            : [],
        ),
      )
      .returning({ id: fieldOptions.id, fieldId: fieldOptions.fieldId, label: fieldOptions.optionLabel });
    const optionId = (fieldIndex: number, label: string) =>
      optionRows.find((row) => row.fieldId === fieldIds[fieldIndex] && row.label === label)!.id;

    const allPoints = sample.flatMap((response) => response.written.flat());
    const topicRows = await tx
      .insert(canonicalTopics)
      .values(
        (Object.keys(TOPICS) as TopicKey[]).map((key) => ({
          formId,
          canonicalName: TOPICS[key].name,
          canonicalSummary: TOPICS[key].summary,
          representativeKeywords: TOPICS[key].keywords,
          topicSize: allPoints.filter((point) => point.topic === key).length,
        })),
      )
      .returning({ id: canonicalTopics.id, name: canonicalTopics.canonicalName });
    const topicId = (key: TopicKey) => topicRows.find((row) => row.name === TOPICS[key].name)!.id;

    // Each response gets its own code, which is how its answers find it below.
    const codes = sample.map(() => createId("resp"));
    const submissionRows = await tx
      .insert(submissions)
      .values(
        sample.map((response, index) => ({
          formId,
          anonymousCode: codes[index],
          submissionStatus: "completed",
          createdAt: response.at,
          updatedAt: response.at,
        })),
      )
      .returning({ id: submissions.id, code: submissions.anonymousCode });
    const submissionId = (index: number) => submissionRows.find((row) => row.code === codes[index])!.id;

    const answerRows = await tx
      .insert(answers)
      .values(
        sample.flatMap((response, index) => {
          const base = { submissionId: submissionId(index), createdAt: response.at, updatedAt: response.at };
          return [
            ...response.choices.map((label, fieldIndex) => ({
              ...base,
              fieldId: fieldIds[fieldIndex]!,
              answerOptionId: optionId(fieldIndex, label),
            })),
            ...response.written.flatMap((written, offset) =>
              written.length > 0
                ? [
                    {
                      ...base,
                      fieldId: fieldIds[3 + offset]!,
                      answerText: written.map((point) => point.text).join(" "),
                      // Already "decomposed", so gnp-ai's ingest queue skips it.
                      decomposedAt: response.at,
                    },
                  ]
                : [],
            ),
          ];
        }),
      )
      .returning({ id: answers.id, submissionId: answers.submissionId, fieldId: answers.fieldId });
    // One answer per question per response, so (submission, question) finds it.
    const answerId = (index: number, fieldId: number) =>
      answerRows.find((row) => row.submissionId === submissionId(index) && row.fieldId === fieldId)!.id;

    await tx.insert(points).values(
      sample.flatMap((response, index) =>
        response.written.flatMap((written, offset) =>
          written.map((point) => ({
            answerId: answerId(index, fieldIds[3 + offset]!),
            canonicalTopicId: point.topic ? topicId(point.topic) : null,
            pointText: point.text,
            sentimentLabel: point.sentiment,
            isViolation: point.violation ?? false,
            assignmentConfidence: point.topic ? 0.9 : null,
            processingStatus: point.topic ? "assigned" : "unknown",
            createdAt: response.at,
            updatedAt: response.at,
          })),
        ),
      ),
    );

    // The dashboard's "AI analysed" time.
    const now = new Date().toISOString();
    await tx.insert(aiModelRuns).values({
      formId,
      modelName: "getting-started-sample",
      parameters: JSON.stringify({ sample: true }),
      status: "completed",
      startedAt: now,
      completedAt: now,
    });
  });
}

// Sign-in waits for the form so the first Home already shows it (a few hundred ms near
// the DB; a few seconds over VPN in dev). The cap only guards against a stuck database.
const SIGN_IN_WAIT_MS = 15_000;

/**
 * Gives a new account its example form. Never fails or hangs sign-in: errors are
 * logged, and past SIGN_IN_WAIT_MS sign-in goes ahead while this finishes on its own.
 * Resolves true once the form is in.
 */
export async function createGettingStartedForm(owner: Owner, { waitMs = SIGN_IN_WAIT_MS } = {}) {
  const startedAt = performance.now();
  const task = insertGettingStartedForm(owner).then(
    () => {
      const tookMs = Math.round(performance.now() - startedAt);
      if (tookMs > 3000) console.warn(`Getting-started form for user ${owner.id} took ${tookMs} ms`);
      return true;
    },
    (error) => {
      console.error(`Could not create the getting-started form for user ${owner.id}`, error);
      return false;
    },
  );
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<false>((resolve) => {
    timer = setTimeout(() => resolve(false), waitMs);
  });
  try {
    return await Promise.race([task, timeout]);
  } finally {
    clearTimeout(timer);
  }
}
