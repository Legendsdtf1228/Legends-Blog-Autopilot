/**
 * Reusable merchant interview packets for missing knowledge (M4).
 * Answers enter as pending revisions and require explicit approval.
 */
import { createHash } from "node:crypto";
import type { ClusterEvidenceBudgetM4, ClaimClass, KnowledgeClass, MerchantInterviewPacket } from "./knowledgeRegistry.js";
import type { OpportunityCluster } from "./opportunityCluster.js";

function packetId(knowledgeClass: KnowledgeClass, questionKeys: string[]): string {
  return createHash("sha1")
    .update(`${knowledgeClass}|${[...questionKeys].sort().join("|")}`)
    .digest("hex")
    .slice(0, 24);
}

function materialPacketHash(packet: Omit<MerchantInterviewPacket, "materialHash">): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        id: packet.id,
        knowledgeClass: packet.knowledgeClass,
        affectedClusterIds: [...packet.affectedClusterIds].sort(),
        questions: packet.questions.map(q => q.id),
        completionStatus: packet.completionStatus
      })
    )
    .digest("hex");
}

const CLASS_FOR_CLAIM: Partial<Record<ClaimClass, KnowledgeClass>> = {
  merchant_experience: "print_shop_growth_lessons",
  merchant_policy: "legends_policies",
  turnaround: "fulfillment_turnaround",
  price_cost: "pricing_cost_facts",
  local_claim: "local_customer_needs",
  customer_result: "print_shop_growth_lessons",
  technical: "technical_specifications",
  comparison_recommendation: "garment_selection",
  product_behavior: "dtf_shop_operations",
  general_educational: "general_authoritative_education"
};

function questionFor(claimClass: ClaimClass, normalizedClaim: string): {
  prompt: string;
  requiredScope: string;
  requiredUnits: string | null;
  requiredDateContext: string | null;
} {
  switch (claimClass) {
    case "price_cost":
      return {
        prompt: `What current numeric price/cost facts apply to: ${normalizedClaim}? Include units and assumptions.`,
        requiredScope: "product/process + audience + geographic applicability",
        requiredUnits: "USD or percent with explicit unit",
        requiredDateContext: "effective as-of date required"
      };
    case "turnaround":
      return {
        prompt: `What is the current turnaround/rush policy for: ${normalizedClaim}?`,
        requiredScope: "production calendar + exclusions",
        requiredUnits: "business days or hours",
        requiredDateContext: "effective as-of date required"
      };
    case "merchant_policy":
      return {
        prompt: `What is the current approved policy fact for: ${normalizedClaim}?`,
        requiredScope: "policy scope and exclusions",
        requiredUnits: null,
        requiredDateContext: "effective as-of date required"
      };
    case "merchant_experience":
      return {
        prompt: `What firsthand shop experience can you approve for public use regarding: ${normalizedClaim}?`,
        requiredScope: "process surface + what is excluded",
        requiredUnits: null,
        requiredDateContext: "when the experience occurred"
      };
    case "local_claim":
      return {
        prompt: `What local (Middle Georgia / Warner Robins) fact applies to: ${normalizedClaim}?`,
        requiredScope: "must remain local; do not generalize nationally",
        requiredUnits: null,
        requiredDateContext: "as-of date"
      };
    case "customer_result":
      return {
        prompt: `What customer-result evidence can be approved with public-usage permission for: ${normalizedClaim}?`,
        requiredScope: "permission + anonymization rules",
        requiredUnits: null,
        requiredDateContext: "observation period"
      };
    default:
      return {
        prompt: `What approved fact should fill the missing knowledge for: ${normalizedClaim}?`,
        requiredScope: "audience/product/process + exclusions",
        requiredUnits: null,
        requiredDateContext: "as-of date when time-sensitive"
      };
  }
}

/**
 * Group missing knowledge across budgets into reusable packets (not article-by-article).
 * Skips claims already supported by active approved knowledge.
 */
export function buildMerchantInterviewPackets(args: {
  budgets: ClusterEvidenceBudgetM4[];
  clusters: OpportunityCluster[];
}): MerchantInterviewPacket[] {
  const clusterById = new Map(args.clusters.map(c => [c.id, c]));
  type Acc = {
    knowledgeClass: KnowledgeClass;
    claimClasses: Set<ClaimClass>;
    prompts: Map<string, { prompt: string; claimClasses: ClaimClass[]; requiredScope: string; requiredUnits: string | null; requiredDateContext: string | null }>;
    clusterIds: Set<string>;
    taskIds: Set<string>;
  };
  const byClass = new Map<KnowledgeClass, Acc>();

  for (const budget of args.budgets) {
    for (const claim of budget.claimRequirements) {
      if (claim.supportStatus === "supported" && claim.safeToState) continue;
      if (
        claim.supportStatus !== "requires_merchant_input" &&
        claim.supportStatus !== "unsupported" &&
        claim.supportStatus !== "prohibited" &&
        claim.supportStatus !== "stale" &&
        !(claim.supportStatus === "partially_supported" && claim.merchantInputRequired)
      ) {
        continue;
      }
      // Only ask when merchant input is actually required or quantitative/policy gaps
      const needsMerchant =
        claim.merchantInputRequired ||
        claim.claimClass === "merchant_experience" ||
        claim.claimClass === "merchant_policy" ||
        claim.claimClass === "turnaround" ||
        claim.claimClass === "price_cost" ||
        claim.claimClass === "local_claim" ||
        claim.claimClass === "customer_result";
      if (!needsMerchant) continue;

      const knowledgeClass = CLASS_FOR_CLAIM[claim.claimClass] || "dtf_shop_operations";
      let acc = byClass.get(knowledgeClass);
      if (!acc) {
        acc = {
          knowledgeClass,
          claimClasses: new Set(),
          prompts: new Map(),
          clusterIds: new Set(),
          taskIds: new Set()
        };
        byClass.set(knowledgeClass, acc);
      }
      acc.claimClasses.add(claim.claimClass);
      acc.clusterIds.add(budget.clusterId);
      acc.taskIds.add(budget.canonicalReaderTaskId);
      const q = questionFor(claim.claimClass, claim.normalizedClaim);
      const qid = createHash("sha1")
        .update(`${knowledgeClass}|${claim.claimClass}|${q.prompt}`)
        .digest("hex")
        .slice(0, 20);
      const existing = acc.prompts.get(qid);
      if (existing) {
        if (!existing.claimClasses.includes(claim.claimClass)) existing.claimClasses.push(claim.claimClass);
      } else {
        acc.prompts.set(qid, {
          prompt: q.prompt,
          claimClasses: [claim.claimClass],
          requiredScope: q.requiredScope,
          requiredUnits: q.requiredUnits,
          requiredDateContext: q.requiredDateContext
        });
      }
      void clusterById;
    }
  }

  const packets: MerchantInterviewPacket[] = [];
  for (const acc of byClass.values()) {
    const questions = [...acc.prompts.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([id, q]) => ({ id, ...q }));
    if (!questions.length) continue;
    const id = packetId(
      acc.knowledgeClass,
      questions.map(q => q.id)
    );
    const withoutHash: Omit<MerchantInterviewPacket, "materialHash"> = {
      id,
      knowledgeClass: acc.knowledgeClass,
      reusableWhy: `Answers for ${acc.knowledgeClass} reuse across ${acc.clusterIds.size} cluster(s) sharing the same knowledge class — not title-specific.`,
      affectedClusterIds: [...acc.clusterIds].sort(),
      affectedReaderTaskIds: [...acc.taskIds].sort(),
      questions,
      completionStatus: "open",
      approvalRequired: true,
      usagePermissionRequired: true
    };
    packets.push({ ...withoutHash, materialHash: materialPacketHash(withoutHash) });
  }

  return packets.sort((a, b) => a.id.localeCompare(b.id));
}
