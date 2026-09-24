import { Router, type IRouter } from "express";
import {
  AnswerMerchantQuestionBody,
  AnswerMerchantQuestionParams,
  AnswerMerchantQuestionResponse,
  GetDashboardResponse,
  GetOwnerSettingsResponse,
  GetPipelineItemParams,
  GetPipelineItemResponse,
  GetPublishingCalendarResponse,
  ListActivityResponse,
  ListKnowledgeEntriesResponse,
  ListMerchantQuestionsResponse,
  ListPipelineItemsQueryParams,
  ListPipelineItemsResponse,
  ListResearchClustersResponse,
  UpdateOwnerSettingsBody,
  UpdateOwnerSettingsResponse,
} from "@workspace/api-zod";
import {
  addOwnerActivity,
  getOwnerConsoleRecord,
  getOwnerConsoleSettings,
  listOwnerConsoleRecords,
  saveOwnerAnswer,
  saveOwnerConsoleSettings,
} from "../lib/owner-console-store";

const router: IRouter = Router();

router.use((req, res, next) => {
  if (process.env.NODE_ENV !== "development") {
    res.status(503).json({ error: "Owner console is disabled outside development." });
    return;
  }
  next();
});

function payloads(records: Array<{ payload: Record<string, unknown> }>) {
  return records.map((record) => record.payload);
}

function sanitizeActivity(event: Record<string, unknown>) {
  const kind = String(event.kind ?? "");
  if (/error|exception|failure/i.test(kind)) {
    return {
      ...event,
      summary: "An operation needs attention",
      detail:
        "Internal error details are hidden from the owner console. Review server logs for diagnostics.",
    };
  }
  return event;
}

function allowedValue(
  value: string | undefined,
  allowed: readonly string[],
): boolean {
  return value === undefined || allowed.includes(value);
}

function isValidDateOnly(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

router.get("/dashboard", async (req, res): Promise<void> => {
  const [pipelineRecords, questionRecords, knowledgeRecords, activities] = await Promise.all([
    listOwnerConsoleRecords("pipeline"),
    listOwnerConsoleRecords("question"),
    listOwnerConsoleRecords("knowledge"),
    listOwnerConsoleRecords("activity"),
  ]);
  const pipeline = payloads(pipelineRecords);
  const questions = payloads(questionRecords);
  const knowledge = payloads(knowledgeRecords);
  const activity = payloads(activities).map(sanitizeActivity);
  const data = GetDashboardResponse.parse({
    operatingMode: "draft_only",
    systemStatus: "Development preview",
    productionPaused: true,
    nextAction:
      "Review source evidence and owner scope before moving any draft forward.",
    counts: {
      pipeline: pipeline.length,
      needsLogan: questions.filter((item) => item.status === "awaiting_answer")
        .length,
      needsEvidence: pipeline.filter(
        (item) =>
          item.evidenceStatus !== "approved" &&
          item.evidenceStatus !== "sufficient",
      ).length,
      knowledgePending: knowledge.filter(
        (item) => item.approvalState !== "approved",
      ).length,
    },
    rollout: {
      reviewedDrafts: 0,
      requiredDrafts: 0,
      published: 0,
      target: 0,
    },
    shopify: {
      status: "Disabled",
      detail:
        "No production Shopify publishing connection is available in this development preview.",
    },
    recentActivity: [...activity]
      .sort(
        (a, b) =>
          new Date(String(b.time)).getTime() -
          new Date(String(a.time)).getTime(),
      )
      .slice(0, 5),
    errors: activity.filter((item) =>
      /error|exception|failure/i.test(String(item.kind)),
    ),
  });
  res.json(data);
});

router.get("/pipeline", async (req, res): Promise<void> => {
  const query = ListPipelineItemsQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: "Invalid pipeline filter." });
    return;
  }

  const records = await listOwnerConsoleRecords("pipeline");
  let items = payloads(records);
  const { status, category, audience } = query.data;
  if (status) {
    items = items.filter(
      (item) => item.stage === status || item.decision === status,
    );
  }
  if (category) {
    items = items.filter((item) => item.category === category);
  }
  if (audience) {
    items = items.filter((item) => item.audience === audience);
  }
  res.json(ListPipelineItemsResponse.parse(items));
});

router.get("/pipeline/:id", async (req, res): Promise<void> => {
  const params = GetPipelineItemParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid pipeline item identifier." });
    return;
  }

  const record = await getOwnerConsoleRecord(params.data.id, "pipeline");
  if (!record) {
    res.status(404).json({ error: "Pipeline item not found." });
    return;
  }
  res.json(GetPipelineItemResponse.parse(record.payload));
});

router.get("/research/clusters", async (_req, res): Promise<void> => {
  const records = await listOwnerConsoleRecords("research");
  res.json(ListResearchClustersResponse.parse(payloads(records)));
});

router.get("/knowledge", async (_req, res): Promise<void> => {
  const records = await listOwnerConsoleRecords("knowledge");
  res.json(ListKnowledgeEntriesResponse.parse(payloads(records)));
});

router.get("/questions", async (_req, res): Promise<void> => {
  const records = await listOwnerConsoleRecords("question");
  res.json(ListMerchantQuestionsResponse.parse(payloads(records)));
});

router.post("/questions/:id/answer", async (req, res): Promise<void> => {
  const params = AnswerMerchantQuestionParams.safeParse(req.params);
  const body = AnswerMerchantQuestionBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Invalid owner answer." });
    return;
  }
  if (
    body.data.answer.trim().length === 0 ||
    body.data.scope.trim().length === 0 ||
    !isValidDateOnly(body.data.effectiveDate)
  ) {
    res.status(400).json({ error: "Answer, scope, and effective date are required." });
    return;
  }

  try {
    await saveOwnerAnswer({
      questionId: params.data.id,
      answer: body.data.answer.trim(),
      scope: body.data.scope.trim(),
      effectiveDate: body.data.effectiveDate,
      publicUsePermission: body.data.publicUsePermission,
    });
  } catch (error) {
    if (error instanceof Error && error.message === "QUESTION_NOT_FOUND") {
      res.status(404).json({ error: "Question not found." });
      return;
    }
    if (error instanceof Error && error.message === "QUESTION_NOT_ANSWERABLE") {
      res.status(409).json({ error: "This question is already awaiting review." });
      return;
    }
    throw error;
  }

  const updated = await getOwnerConsoleRecord(params.data.id, "question");
  if (!updated) {
    res.status(404).json({ error: "Question not found." });
    return;
  }
  res.json(AnswerMerchantQuestionResponse.parse(updated.payload));
});

router.get("/calendar", async (_req, res): Promise<void> => {
  const records = await listOwnerConsoleRecords("calendar");
  res.json(GetPublishingCalendarResponse.parse(payloads(records)));
});

router.get("/settings", async (_req, res): Promise<void> => {
  res.json(GetOwnerSettingsResponse.parse(await getOwnerConsoleSettings()));
});

router.patch("/settings", async (req, res): Promise<void> => {
  const parsed = UpdateOwnerSettingsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid settings update." });
    return;
  }

  const patch = parsed.data;
  if (
    (patch.operatingMode !== undefined &&
      patch.operatingMode !== "draft_only") ||
    patch.emergencyPause === false ||
    !allowedValue(patch.frequency, ["weekly", "twice_weekly", "monthly"]) ||
    !allowedValue(patch.geography, ["US", "North America", "Global"]) ||
    !allowedValue(patch.tone, ["practical", "warm", "technical"]) ||
    !allowedValue(patch.depth, ["brief", "standard", "deep"])
  ) {
    res.status(400).json({
      error:
        "Production pause and draft-only mode are locked. Only safe drafting preferences can be changed.",
    });
    return;
  }

  const { operatingMode: _operatingMode, emergencyPause: _pause, ...safePatch } =
    patch;
  if (Object.keys(safePatch).length === 0) {
    res.status(400).json({ error: "No safe settings were provided." });
    return;
  }

  const settings = await saveOwnerConsoleSettings(safePatch);
  await addOwnerActivity(
    "settings_updated",
    "Safe drafting preferences updated",
    "Locked operating mode, production pause, publishing, and eligibility rules were unchanged.",
  );
  res.json(UpdateOwnerSettingsResponse.parse(settings));
});

router.get("/activity", async (_req, res): Promise<void> => {
  const records = await listOwnerConsoleRecords("activity");
  const events = payloads(records).map(sanitizeActivity);
  res.json(ListActivityResponse.parse(events));
});

export default router;