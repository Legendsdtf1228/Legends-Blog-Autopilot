import type { Db } from "../db.js";
import type { Settings } from "../types.js";

export async function countPublishedLast7Days(db: Db): Promise<number> {
  const { rows } = await db.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM articles
     WHERE status='published' AND published_at >= now() - interval '7 days'`
  );
  return Number(rows[0]?.count ?? 0);
}

export async function hoursSinceLastPublish(db: Db): Promise<number | null> {
  const { rows } = await db.query<{ published_at: string }>(
    `SELECT published_at FROM articles WHERE status='published' AND published_at IS NOT NULL
     ORDER BY published_at DESC LIMIT 1`
  );
  if (!rows[0]?.published_at) return null;
  const ms = Date.now() - new Date(rows[0].published_at).getTime();
  return ms / 3_600_000;
}

/** Frequency gate for AUTO_PUBLISH — research may still run. */
export async function canPublishUnderFrequencyLimits(
  db: Db,
  settings: Settings
): Promise<{ ok: boolean; reason?: string }> {
  const weekly = await countPublishedLast7Days(db);
  if (weekly >= settings.frequencyLimits.maxPublishedPerRolling7Days) {
    return {
      ok: false,
      reason: `Rolling 7-day publish limit reached (${weekly}/${settings.frequencyLimits.maxPublishedPerRolling7Days}).`
    };
  }
  const hours = await hoursSinceLastPublish(db);
  if (hours !== null && hours < settings.frequencyLimits.minHoursBetweenPublishes) {
    return {
      ok: false,
      reason: `Minimum spacing not met (${hours.toFixed(1)}h < ${settings.frequencyLimits.minHoursBetweenPublishes}h).`
    };
  }
  return { ok: true };
}
