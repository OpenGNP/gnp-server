import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "../config/env";
import {
  organizations,
  users,
  folders,
  forms,
  formFields,
  fieldOptions,
  submissions,
  answers,
  points,
  canonicalTopics,
  topicTrends,
  unassignedPoints,
} from "../db/schema";
import { hashPassword } from "../utils/password";

const client = postgres(env.DATABASE_URL);
const db = drizzle(client);

const daysAgo = (n: number) => new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString();

async function insertReturning<T>(query: Promise<T[]>): Promise<T> {
  const [row] = await query;
  if (!row) throw new Error("Insert returned no row");
  return row;
}

// ---------------------------------------------------------------------------
// Mock data (content adapted from the SIT focus group tracking dataset)
// ---------------------------------------------------------------------------

const PROGRAMS = ["Computer Science", "Information Technology", "Data Science", "International Program"];

const FORMS = [
  {
    title: "SIT Annual Focus Group 2025",
    description: "Open-ended feedback from SIT students",
    startDaysAgo: 90,
    endDaysAgo: 0,
  },
  {
    title: "SIT Annual Focus Group 2024",
    description: "Open-ended feedback from SIT students (previous cycle)",
    startDaysAgo: 450,
    endDaysAgo: 360,
  },
];

const TOPICS = [
  {
    name: "Curriculum & Course Content",
    summary: "Feedback about course relevance, difficulty progression, outdated material, and overlap between related subjects.",
    keywords: "curriculum, CS102, outdated courses, data science, Docker, Kubernetes",
  },
  {
    name: "Communication & Coordination",
    summary: "Feedback about the platforms and responsiveness used for sharing assignments, announcements, and staff communication.",
    keywords: "LINE, Microsoft Teams, staff response, announcements",
  },
  {
    name: "Campus Facilities & Equipment",
    summary: "Feedback about classroom buildings, furniture, air conditioning, and co-working spaces.",
    keywords: "CB building, LX building, chairs, air conditioning, monitors",
  },
  {
    name: "IT Infrastructure & Network",
    summary: "Feedback about internet speed, WiFi reliability, and virtual machine request processes.",
    keywords: "internet speed, WiFi, VM request, CB2",
  },
  {
    name: "International Student Support",
    summary: "Feedback about English-friendly activities, access to student organizations, and timely communication for international students.",
    keywords: "international students, SAMOSIT, English-friendly, IR office",
  },
  {
    name: "Internship & Career Support",
    summary: "Feedback about internship duration, project-based learning, and support finding placements.",
    keywords: "internship, project-based, partnerships, career support",
  },
  {
    name: "Scholarships & Financial Support",
    summary: "Feedback about scholarship restrictions and decreasing award amounts for students.",
    keywords: "scholarship, academic award, financial support",
  },
  {
    name: "Faculty Conduct & Wellbeing",
    summary: "Feedback about instructor behavior, fairness, and communication skills affecting the learning environment.",
    keywords: "unequal treatment, professional conduct, staff behavior",
  },
] as const;

type Sentiment = "positive" | "neutral" | "negative";

type MockPoint = {
  text: string;
  topic: (typeof TOPICS)[number]["name"] | null;
  sentiment: Sentiment;
  severe?: boolean;
};

type MockFeedback = {
  program: (typeof PROGRAMS)[number];
  raw: string;
  points: MockPoint[];
};

const FEEDBACK: MockFeedback[] = [
  {
    program: "Computer Science",
    raw: "I would say I learn a lot and I learn kinda fast compared to before, but CS102 is a bit unpredictable, like I'm not sure what it's gonna be on the exam. If you just do DIY you can't do the hard quiz questions. I got better than others because I got a good mentor like P.Philix, but that also makes it not stable.",
    points: [
      { text: "I learn a lot and learn quickly compared to before when I learned by myself, but CS102 is a bit unpredictable, and I'm unsure what will be on the exam.", topic: "Curriculum & Course Content", sentiment: "neutral" },
      { text: "If you only do DIY, you can't handle hard quiz questions; it's not because the questions are inherently hard, but because they don't gradually increase in difficulty.", topic: "Curriculum & Course Content", sentiment: "negative" },
      { text: "I got better in CS102 because I had a good mentor, P.Philix, who is good at teaching compared to other instructors, but this also made the experience unstable.", topic: "Curriculum & Course Content", sentiment: "neutral" },
      { text: "I learn best by listening, practicing, and then doing; programming is confusing, especially when starting with Java, which is complicated compared to Python.", topic: "Curriculum & Course Content", sentiment: "negative" },
    ],
  },
  {
    program: "Computer Science",
    raw: "Surely the job landscape has changed rapidly as AI growth and market saturation is happening right now. Fundamental courses like CSC102, 122 are mandatory and important, meaning no change is needed. But when it comes to infrastructure like Docker and Kubernetes, we don't know much about it.",
    points: [
      { text: "The job landscape has changed rapidly due to AI growth and market saturation, and the curriculum needs to be updated accordingly.", topic: "Curriculum & Course Content", sentiment: "negative" },
      { text: "Fundamental courses like CSC102 and CSC122 are crucial for CS students and should not be changed.", topic: "Curriculum & Course Content", sentiment: "positive" },
      { text: "There is a lack of understanding about infrastructure topics such as Docker and Kubernetes.", topic: "Curriculum & Course Content", sentiment: "negative" },
      { text: "CS students should learn to adapt and find solutions on their own, rather than relying solely on the curriculum.", topic: "Curriculum & Course Content", sentiment: "neutral" },
    ],
  },
  {
    program: "Data Science",
    raw: "I feel like the curriculum right now is too data-sci oriented but not in a way that we can adapt it in real life. The data sci course is too theory based, and the content overlaps with data visualization, big data, and data mining.",
    points: [
      { text: "The curriculum is too data science-oriented, but not in a way that we can apply it in real life.", topic: "Curriculum & Course Content", sentiment: "negative" },
      { text: "The data science course is too theory-based.", topic: "Curriculum & Course Content", sentiment: "negative" },
      { text: "The content of the data science course overlaps with data visualization, big data, and data mining.", topic: "Curriculum & Course Content", sentiment: "negative" },
    ],
  },
  {
    program: "Computer Science",
    raw: "LNG class, AJ.Jarah is using LINE as the main communication channel for assignments, class materials, and important course details. I don't understand why, LINE has limited message history and isn't professional. Materials should be posted on Microsoft Teams or CSCMS instead.",
    points: [
      { text: "In Jarah's course, I don't understand why LINE is used as the primary platform for assignments, class materials, and important course details.", topic: "Communication & Coordination", sentiment: "negative" },
      { text: "LINE is not a suitable platform for managing academic information due to its limited message history accessibility and lack of professionalism.", topic: "Communication & Coordination", sentiment: "negative" },
      { text: "Assignments and course materials should be consistently posted on Microsoft Teams or CSCMS in a clear, concrete, and centralized manner to reduce misunderstandings.", topic: "Communication & Coordination", sentiment: "neutral" },
    ],
  },
  {
    program: "Information Technology",
    raw: "Once again when contacting any staff faculty members of SIT, I will receive no responses on LINE and no further response or communication whatsoever on Teams, making communication a very difficult issue especially regarding course information or emergency situations.",
    points: [
      { text: "When contacting staff faculty members of SIT, no responses are received on LINE or Teams, making communication very difficult, especially for course information or emergency situations.", topic: "Communication & Coordination", sentiment: "negative" },
    ],
  },
  {
    program: "Computer Science",
    raw: "I understand that P'Nick has a heavy workload, but leaving students' messages on read is not acceptable. P'DJ's position is unclear, sometimes acting like a senior student, sometimes like a professor, and female and Thai students receive better treatment and more attention, including a pattern of flirting with students that must be stopped immediately.",
    points: [
      { text: "Female students and Thai students receive better treatment and more attention, and there is a clear pattern of flirting with students that is completely unacceptable and must be stopped immediately.", topic: "Faculty Conduct & Wellbeing", sentiment: "negative", severe: true },
      { text: "P'DJ's position is unclear, sometimes acting like a senior student, sometimes like a professor, which creates tension during activities.", topic: "Faculty Conduct & Wellbeing", sentiment: "negative" },
      { text: "P'DJ should receive training on professional conduct and learn to treat all students fairly and respectfully.", topic: "Faculty Conduct & Wellbeing", sentiment: "neutral" },
    ],
  },
  {
    program: "Information Technology",
    raw: "We would like to have classes in the LX building, which has much better equipment and facilities compared to the CB building. The co-working space also needs improvement in air circulation and odor control, and equipment should be updated to be more modern.",
    points: [
      { text: "We would like to have classes in the LX building because it has much better equipment and facilities compared to the CB building.", topic: "Campus Facilities & Equipment", sentiment: "neutral" },
      { text: "The co-working space in the faculty needs improvement in terms of air circulation and odor control.", topic: "Campus Facilities & Equipment", sentiment: "negative" },
      { text: "The equipment in the faculty should be updated to be more modern.", topic: "Campus Facilities & Equipment", sentiment: "negative" },
    ],
  },
  {
    program: "Computer Science",
    raw: "For CB building I'd give it 4/10 before, but now it's slightly better at 7/10. The old chairs and desks can't even hold a tablet or laptop properly, and we need more electrical plugs. For LX, the AC would be great if it were more adjustable.",
    points: [
      { text: "I would give CB building 4/10 initially, but now it's slightly better at 7/10 after the facilities were changed.", topic: "Campus Facilities & Equipment", sentiment: "positive" },
      { text: "The current chairs, desks, and tables in CB building are uncomfortable and old, some of which can't even hold a tablet or laptop properly.", topic: "Campus Facilities & Equipment", sentiment: "negative" },
      { text: "There should be more electrical outlets in CB building.", topic: "Campus Facilities & Equipment", sentiment: "neutral" },
      { text: "The air conditioning in LX is sometimes too hot and sometimes too cold, and it would be great if it was more adjustable.", topic: "Campus Facilities & Equipment", sentiment: "negative" },
    ],
  },
  {
    program: "Data Science",
    raw: "Please add monitors to Common Rooms, and add better WiFi connectivity to the CB2 classroom as it either keeps disconnecting or wouldn't appear in the WiFi list, especially SIT-Secure.",
    points: [
      { text: "Please add monitors to Common Rooms.", topic: "Campus Facilities & Equipment", sentiment: "neutral" },
      { text: "Add better WiFi connectivity to CB2 classroom because it either keeps disconnecting or wouldn't appear in the WiFi list, especially SIT-Secure.", topic: "IT Infrastructure & Network", sentiment: "negative" },
    ],
  },
  {
    program: "Computer Science",
    raw: "The internet in CB building is extremely slow. Requesting a VM takes a very long time, staff pass responsibilities to each other, and the process has too many steps with many limitations.",
    points: [
      { text: "The internet in CB building is extremely slow.", topic: "IT Infrastructure & Network", sentiment: "negative" },
      { text: "The process of requesting a VM has too many steps with many limitations.", topic: "IT Infrastructure & Network", sentiment: "negative" },
    ],
  },
  {
    program: "International Program",
    raw: "The activities are fun and pretty helpful, but maybe SIT can consider opening more for international students, like more English-friendly activities and opening SAMOSIT for international students too, so we have equal opportunity as Thai students.",
    points: [
      { text: "The activities in SIT are fun and helpful, but SIT should consider opening more opportunities for international students, such as English-friendly activities and access to SAMOSIT.", topic: "International Student Support", sentiment: "neutral" },
      { text: "International students should have equal opportunities as Thai students in SIT.", topic: "International Student Support", sentiment: "negative" },
    ],
  },
  {
    program: "International Program",
    raw: "Important academic and opportunity-related information does not always reach Burmese students (or other international students) in a timely or clear manner, such as the Taiwan internship. The Faculty of Engineering and Science's International Affairs office is very active, while SIT IR has been relatively quiet, and some students don't even know it exists.",
    points: [
      { text: "Important academic and opportunity-related information does not always reach Burmese students or other international students in a timely or clear manner, for example the Taiwan internship, while other international majors had already been preparing since the previous semester.", topic: "International Student Support", sentiment: "negative" },
      { text: "The Faculty of Engineering and Science has its own International Affairs office, which is very active in regularly posting overseas opportunities, whereas the SIT International Relations office has been relatively quiet.", topic: "International Student Support", sentiment: "negative" },
      { text: "Some students are not even aware that the SIT International Relations office exists.", topic: "International Student Support", sentiment: "negative" },
    ],
  },
  {
    program: "Computer Science",
    raw: "All courses should adapt and focus more on projects. Also, internship duration of 2 months during the summer seems a bit too little and the timing is a bit off.",
    points: [
      { text: "All courses should adapt and focus more on projects.", topic: "Curriculum & Course Content", sentiment: "neutral" },
      { text: "The internship duration of 2 months during the summer seems too short.", topic: "Internship & Career Support", sentiment: "negative" },
    ],
  },
  {
    program: "Computer Science",
    raw: "Scholarships have too many restrictions for Thai students, and the Academic Award amount decreases every year. Moving to a foreign country is already difficult, and the faculty needs to provide much more support for internships, similar to the Engineering faculty.",
    points: [
      { text: "Scholarships have too many restrictions for Thai students, and the Academic Award amount decreases every year.", topic: "Scholarships & Financial Support", sentiment: "negative" },
      { text: "Moving to a foreign country is already difficult, and I hope the faculty can build a stronger community for international students.", topic: "International Student Support", sentiment: "negative" },
      { text: "I would like to see internship partnerships similar to those in the Engineering faculty to make finding internships easier.", topic: "Internship & Career Support", sentiment: "neutral" },
    ],
  },
  {
    program: "International Program",
    raw: "IA organizes activities much more frequently than SIT. Additionally, P'Nui's English communication skills are limited, which often makes communication difficult.",
    points: [
      { text: "IA organizes activities much more frequently than SIT.", topic: "International Student Support", sentiment: "negative" },
      { text: "P'Nui's English communication skills are limited, which often makes communication difficult.", topic: "Communication & Coordination", sentiment: "negative" },
    ],
  },
  {
    program: "International Program",
    raw: "Since I'm from CS which is originally an English program, most mandatory activities are fine. But there are a lot of activities held in Thai that we, as international students, would love to participate in but can't because they're not English-friendly, even though we try to be active at the university.",
    points: [
      { text: "This limits our ability to engage in university activities despite our efforts to be active.", topic: null, sentiment: "neutral" },
    ],
  },
];

// ---------------------------------------------------------------------------
// Seed
// ---------------------------------------------------------------------------

async function clearTables() {
  const tablesInDeleteOrder = [
    unassignedPoints,
    points,
    topicTrends,
    canonicalTopics,
    answers,
    fieldOptions,
    formFields,
    submissions,
    forms,
    folders,
    users,
    organizations,
  ];
  for (const table of tablesInDeleteOrder) {
    await db.delete(table);
  }
}

async function main() {
  await clearTables();

  const org = await insertReturning(
    db
      .insert(organizations)
      .values({
        organizationName: "King Mongkut's University of Technology Thonburi - SIT",
        organizationDomain: "sit.kmutt.ac.th",
        createdAt: daysAgo(120),
      })
      .returning(),
  );

  const userSeeds = [
    { fullName: "Admin User", email: "admin@sit.kmutt.ac.th", role: "admin" },
    { fullName: "HR Staff", email: "hr@sit.kmutt.ac.th", role: "staff" },
  ];
  const insertedUsers = [];
  for (const u of userSeeds) {
    const row = await insertReturning(
      db
        .insert(users)
        .values({ ...u, password: await hashPassword("mock-hashed-password"), organizationId: org.id, createdAt: daysAgo(120) })
        .returning(),
    );
    insertedUsers.push(row);
  }
  const admin = insertedUsers[0]!;

  const folder = await insertReturning(
    db
      .insert(folders)
      .values({
        adminId: admin.id,
        folderName: "SIT Focus Group",
        folderDescription: "Annual SIT student focus group feedback",
        createdAt: daysAgo(120),
      })
      .returning(),
  );

  const formContexts = [];
  for (const f of FORMS) {
    const form = await insertReturning(
      db
        .insert(forms)
        .values({
          adminId: admin.id,
          folderId: folder.id,
          organizationId: org.id,
          formTitle: f.title,
          formDescription: f.description,
          status: "active",
          accessType: "organization",
          recordName: false,
          oneResponsePerPerson: true,
          startDate: daysAgo(f.startDaysAgo),
          endDate: daysAgo(f.endDaysAgo),
          createdAt: daysAgo(f.startDaysAgo),
        })
        .returning(),
    );

    const programField = await insertReturning(
      db
        .insert(formFields)
        .values({ formId: form.id, fieldLabel: "Program", fieldType: "radio", isRequired: true, fieldOrder: 1, createdAt: daysAgo(f.startDaysAgo) })
        .returning(),
    );

    const programOptionIds = new Map<string, number>();
    for (const [i, program] of PROGRAMS.entries()) {
      const opt = await insertReturning(
        db
          .insert(fieldOptions)
          .values({ fieldId: programField.id, optionLabel: program, optionValue: program, optionOrder: i + 1, createdAt: daysAgo(f.startDaysAgo) })
          .returning(),
      );
      programOptionIds.set(program, opt.id);
    }

    const feedbackField = await insertReturning(
      db
        .insert(formFields)
        .values({ formId: form.id, fieldLabel: "Feedback", fieldType: "textarea", isRequired: true, fieldOrder: 2, createdAt: daysAgo(f.startDaysAgo) })
        .returning(),
    );

    formContexts.push({ form, programField, feedbackField, programOptionIds, startDaysAgo: f.startDaysAgo, endDaysAgo: f.endDaysAgo });
  }

  const topicIds = new Map<string, number>();
  for (const topic of TOPICS) {
    const row = await insertReturning(
      db
        .insert(canonicalTopics)
        .values({
          canonicalName: topic.name,
          canonicalSummary: topic.summary,
          representativeKeywords: topic.keywords,
          topicSize: 0,
          status: "active",
          firstDetectedAt: daysAgo(90),
          lastUpdatedAt: daysAgo(0),
          createdAt: daysAgo(90),
        })
        .returning(),
    );
    topicIds.set(topic.name, row.id);
  }

  const insertedPoints: { topicId: number | null; sentiment: Sentiment; severe: boolean; ctxIndex: number }[] = [];

  // Spread the mock submissions round-robin across the available forms so each
  // form (and each period) ends up with its own realistic slice of feedback.
  const feedbackChunks = formContexts.map((_, ctxIndex) => FEEDBACK.filter((_, i) => i % formContexts.length === ctxIndex));

  let submissionCounter = 0;
  for (const [ctxIndex, ctx] of formContexts.entries()) {
    const chunk = feedbackChunks[ctxIndex]!;
    const span = ctx.startDaysAgo - ctx.endDaysAgo;

    for (const [j, fb] of chunk.entries()) {
      submissionCounter += 1;
      const submittedAt = daysAgo(ctx.endDaysAgo + Math.floor((span * (chunk.length - j)) / chunk.length));

      const submission = await insertReturning(
        db
          .insert(submissions)
          .values({
            formId: ctx.form.id,
            anonymousCode: `SIT-${String(submissionCounter).padStart(4, "0")}`,
            submissionStatus: "completed",
            createdAt: submittedAt,
          })
          .returning(),
      );

      await db.insert(answers).values({
        submissionId: submission.id,
        fieldId: ctx.programField.id,
        answerOptionId: ctx.programOptionIds.get(fb.program) ?? null,
        createdAt: submittedAt,
      });

      const answer = await insertReturning(
        db
          .insert(answers)
          .values({ submissionId: submission.id, fieldId: ctx.feedbackField.id, answerText: fb.raw, createdAt: submittedAt })
          .returning(),
      );

      for (const p of fb.points) {
        const topicId = p.topic ? topicIds.get(p.topic) ?? null : null;
        const severe = p.severe ?? false;

        const pointRow = await insertReturning(
          db
            .insert(points)
            .values({
              answerId: answer.id,
              canonicalTopicId: topicId,
              pointText: p.text,
              sentimentLabel: p.sentiment,
              isSevere: severe,
              assignmentConfidence: topicId ? 0.75 + Math.random() * 0.24 : null,
              processingStatus: topicId ? "assigned" : "unknown",
              createdAt: submittedAt,
            })
            .returning(),
        );

        if (!topicId) {
          await db.insert(unassignedPoints).values({
            pointId: pointRow.id,
            reason: "no_matching_topic",
            createdAt: submittedAt,
          });
        }

        insertedPoints.push({ topicId, sentiment: p.sentiment, severe, ctxIndex });
      }
    }
  }

  for (const topic of TOPICS) {
    const topicId = topicIds.get(topic.name);
    if (!topicId) continue;

    const topicPoints = insertedPoints.filter((p) => p.topicId === topicId);
    await db.update(canonicalTopics).set({ topicSize: topicPoints.length, lastUpdatedAt: daysAgo(0) }).where(eq(canonicalTopics.id, topicId));
  }

  // One topicTrends row per topic per form period, so the dashboard has real rising/falling trend data to show.
  for (const [ctxIndex, ctx] of formContexts.entries()) {
    const periodStart = daysAgo(ctx.startDaysAgo);
    const periodEnd = daysAgo(ctx.endDaysAgo);

    for (const topic of TOPICS) {
      const topicId = topicIds.get(topic.name);
      if (!topicId) continue;

      const topicPoints = insertedPoints.filter((p) => p.topicId === topicId && p.ctxIndex === ctxIndex);
      if (topicPoints.length === 0) continue;

      await db.insert(topicTrends).values({
        canonicalTopicId: topicId,
        periodStart,
        periodEnd,
        feedbackCount: topicPoints.length,
        positiveCount: topicPoints.filter((p) => p.sentiment === "positive").length,
        neutralCount: topicPoints.filter((p) => p.sentiment === "neutral").length,
        negativeCount: topicPoints.filter((p) => p.sentiment === "negative").length,
        severeCount: topicPoints.filter((p) => p.severe).length,
        createdAt: periodEnd,
      });
    }
  }

  console.log(`Seed complete: ${FEEDBACK.length} feedback submissions across ${formContexts.length} forms, ${insertedPoints.length} points, ${TOPICS.length} topics.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await client.end();
  });
