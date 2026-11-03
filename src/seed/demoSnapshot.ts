/**
 * Demo snapshot: the /demo form's real AI results, saved for the client's landing page and
 * empty-form tour (gnp-client/src/data/demoSnapshot.json). Same reads as the /demo routes.
 *
 * Run after `bun run seed:demo` and the AI workers have finished:  bun run demo:snapshot
 */
import { analyticsController } from "../controllers/analyticsController";
import { queryClient } from "../db/client";
import { getDemoForm } from "../services/demoForm";

const OUT = new URL("../../../gnp-client/src/data/demoSnapshot.json", import.meta.url);
const tz = "Asia/Bangkok";

async function main() {
  const form = await getDemoForm();
  const [themes, trend, responses, individual] = await Promise.all([
    analyticsController.formThemes(form.id, form.adminId, { tz }),
    analyticsController.formTrend(form.id, form.adminId, { tz }),
    analyticsController.formResponses(form.id, form.adminId),
    analyticsController.individualResponses(form.id, form.adminId),
  ]);
  await Bun.write(OUT, JSON.stringify({ themes, trend, responses, individual }, null, 2) + "\n");
  console.log(`Demo snapshot written: ${OUT.pathname} (${themes.aiDiscoveredTopics.length} topics).`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await queryClient.end();
  });
