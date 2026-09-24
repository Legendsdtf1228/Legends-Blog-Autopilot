import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import { randomUUID } from "node:crypto";
import { createDb, migrate } from "../src/db.js";
import { mountOwnerConsole } from "../src/ownerConsole.js";

const databaseUrl = process.env.DATABASE_URL || "postgresql://legends:legends@localhost:5432/legends_blog";

test("owner console answers questions independently and keeps every answer pending", async () => {
  const db = createDb(databaseUrl);
  const packetId = `owner-console-test-${randomUUID()}`;
  const questionIds = [randomUUID(), randomUUID()];
  let server: ReturnType<ReturnType<typeof express>["listen"]> | undefined;
  let entryIds: string[] = [];

  try {
    await migrate(db);
    const before = await db.query<{ n: string }>(`SELECT count(*)::text n
      FROM merchant_interview_questions q
      JOIN merchant_interview_packets p ON p.id=q.packet_id
      LEFT JOIN merchant_interview_answers a ON a.packet_id=q.packet_id AND a.question_id=q.id
      WHERE p.completion_status IN ('open','answered_pending_approval') AND a.question_id IS NULL`);

    await db.query(
      `INSERT INTO merchant_interview_packets(id,knowledge_class,payload,material_hash,completion_status)
       VALUES ($1,'print_shop_growth_lessons',$2::jsonb,$3,'open')`,
      [packetId, JSON.stringify({ affectedClusterIds: ["test-cluster"] }), packetId],
    );
    for (const [index, questionId] of questionIds.entries()) {
      await db.query(
        `INSERT INTO merchant_interview_questions(id,packet_id,prompt,payload)
         VALUES ($1,$2,$3,$4::jsonb)`,
        [questionId, packetId, `Test question ${index + 1}`, JSON.stringify({ requiredScope: "Product and region" })],
      );
    }

    const app = express();
    app.use(express.urlencoded({ extended: false }));
    const router = express.Router();
    mountOwnerConsole(router, db, () => "test-csrf", () => true);
    app.use("/owner", router);
    server = app.listen(0, "127.0.0.1");
    await new Promise<void>((resolve, reject) => {
      server!.once("error", reject);
      server!.once("listening", resolve);
    });
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const baseUrl = `http://127.0.0.1:${address.port}`;

    const dashboardCount = async (): Promise<number> => {
      const response = await fetch(`${baseUrl}/owner/`);
      assert.equal(response.status, 200);
      const html = await response.text();
      const match = html.match(/Questions needing an answer<\/h2><strong class="count">(\d+)<\/strong>/);
      assert.ok(match, "dashboard should show the unanswered-question count");
      return Number(match[1]);
    };
    const postAnswer = async (questionId: string, answer: string): Promise<Response> => fetch(
      `${baseUrl}/owner/questions/${questionId}/answer`,
      {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          answer,
          scope: "DTF production; print shop owners",
          effectiveDate: "2026-09-01",
          publicUsePermission: "on",
          _csrf: "test-csrf",
        }),
        redirect: "manual",
      },
    );

    const initialCount = Number(before.rows[0]?.n ?? "0");
    assert.equal(await dashboardCount(), initialCount + 2);

    const first = await postAnswer(questionIds[0]!, "First firsthand answer.");
    assert.equal(first.status, 303);
    assert.equal(await dashboardCount(), initialCount + 1, "one unanswered question should remain");

    const questionPage = await (await fetch(`${baseUrl}/owner/questions`)).text();
    assert.match(questionPage, /First firsthand answer\./);
    assert.doesNotMatch(questionPage, new RegExp(`/owner/questions/${questionIds[0]}/answer`));
    assert.match(questionPage, new RegExp(`/owner/questions/${questionIds[1]}/answer`));

    const duplicate = await postAnswer(questionIds[0]!, "Replacement answer must be rejected.");
    assert.equal(duplicate.status, 409);

    const second = await postAnswer(questionIds[1]!, "Second firsthand answer.");
    assert.equal(second.status, 303, "an unanswered question remains answerable after its packet enters review");
    assert.equal(await dashboardCount(), initialCount);

    const answers = await db.query<{
      question_id: string;
      entry_id: string;
      approval_state: string;
      public_usage_allowed: boolean;
    }>(`SELECT a.question_id,a.entry_id,k.approval_state,
        (k.payload->>'publicUsageAllowed')::boolean AS public_usage_allowed
      FROM merchant_interview_answers a
      JOIN knowledge_entries k ON k.id=a.entry_id
      WHERE a.packet_id=$1 ORDER BY a.question_id`, [packetId]);
    entryIds = answers.rows.map(row => row.entry_id);
    assert.equal(answers.rows.length, 2);
    for (const row of answers.rows) {
      assert.equal(row.approval_state, "PENDING_APPROVAL");
      assert.equal(row.public_usage_allowed, false, "requested public use must not bypass M5 approval");
    }
  } finally {
    if (server?.listening) {
      await new Promise<void>((resolve, reject) => server!.close(error => error ? reject(error) : resolve()));
    }
    if (entryIds.length) await db.query("DELETE FROM knowledge_entries WHERE id = ANY($1::text[])", [entryIds]);
    await db.query("DELETE FROM merchant_interview_packets WHERE id=$1", [packetId]);
    await db.end();
  }
});