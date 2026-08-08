/**
 * Content-promise classification: what evidence a title/keyword commits to deliver.
 * Feature-based — no exact-title quarantines.
 */

export type ContentPromiseClass =
  | "firsthand_experience"
  | "cost_pricing"
  | "comparison"
  | "how_to_guide"
  | "technical_production"
  | "local_commercial"
  | "informational_general";

export interface ContentPromise {
  primaryClass: ContentPromiseClass;
  classes: ContentPromiseClass[];
  requiresFirsthand: boolean;
  requiresVerifiedNumbers: boolean;
  requiresComparisonCriteria: boolean;
  requiresActionableSteps: boolean;
  requiresTechnicalKnowledge: boolean;
  requiresLocalRelevance: boolean;
  reasons: string[];
}

export function classifyContentPromise(args: {
  title: string;
  primaryKeyword: string;
  format?: string;
  intent?: string;
  pillar?: string;
}): ContentPromise {
  const hay = `${args.title} ${args.primaryKeyword} ${args.format || ""} ${args.pillar || ""}`.toLowerCase();
  const classes: ContentPromiseClass[] = [];
  const reasons: string[] = [];

  const firsthandLanguage =
    /\b(reality|lessons?|our story|what i learned|first-?person|behind the scenes|honest|quit(ting)?|burnout)\b/i.test(hay);
  const operationalHowTo =
    /\b(how to|checklist|questions? to ask|order timeline|plan|guide|steps?)\b/i.test(hay) ||
    args.format === "how_to" ||
    args.format === "checklist";
  // Format/pillar alone must not force firsthand when the keyword is an operational how-to.
  if (
    firsthandLanguage ||
    ((args.format === "first_person_story" ||
      args.pillar === "honest_entrepreneurship" ||
      args.pillar === "legends_story") &&
      !operationalHowTo)
  ) {
    classes.push("firsthand_experience");
    reasons.push("Title/format promises firsthand experience or lessons.");
  }
  if (/\b(cost|price|pricing|break-?even|profit|margin|budget|how much)\b/i.test(hay)) {
    classes.push("cost_pricing");
    reasons.push("Title promises cost/pricing guidance.");
  }
  if (/\b(best|vs\.?|versus|compar(e|ison)|which (is|are) better|alternative)\b/i.test(hay) ||
      args.format === "comparison") {
    classes.push("comparison");
    reasons.push("Title promises a comparison.");
  }
  if (/\b(how to|guide|checklist|steps?|questions? to ask|what to (ask|look))\b/i.test(hay) ||
      args.format === "how_to" ||
      args.format === "checklist" ||
      args.format === "faq") {
    classes.push("how_to_guide");
    reasons.push("Title promises actionable how-to / checklist guidance.");
  }
  if (/\b(dtf|uv dtf|heat press|pressing|embroidery|screen print|gang sheet|artwork|resolution|dpi|transfer|printer pass)\b/i.test(hay) ||
      args.pillar === "dtf_education") {
    classes.push("technical_production");
    reasons.push("Title promises technical production guidance.");
  }
  if (/\b(local|warner robins|middle georgia|near me|choose a .*printer)\b/i.test(hay) ||
      args.intent === "local") {
    classes.push("local_commercial");
    reasons.push("Title promises local commercial buyer guidance.");
  }

  if (!classes.length) {
    classes.push("informational_general");
    reasons.push("General informational content.");
  }

  // Prefer the most demanding class as primary.
  // Local commercial how-tos keep local_commercial primary when intent is local.
  const preferLocal =
    args.intent === "local" ||
    (classes.includes("local_commercial") &&
      !classes.includes("firsthand_experience") &&
      !classes.includes("cost_pricing") &&
      !classes.includes("comparison") &&
      !classes.includes("technical_production"));
  const priority: ContentPromiseClass[] = preferLocal
    ? [
        "firsthand_experience",
        "cost_pricing",
        "comparison",
        "local_commercial",
        "technical_production",
        "how_to_guide",
        "informational_general"
      ]
    : [
        "firsthand_experience",
        "cost_pricing",
        "comparison",
        "technical_production",
        "how_to_guide",
        "local_commercial",
        "informational_general"
      ];
  const primaryClass = priority.find(c => classes.includes(c)) || "informational_general";

  return {
    primaryClass,
    classes,
    requiresFirsthand: classes.includes("firsthand_experience"),
    requiresVerifiedNumbers: classes.includes("cost_pricing"),
    requiresComparisonCriteria: classes.includes("comparison"),
    requiresActionableSteps: classes.includes("how_to_guide"),
    requiresTechnicalKnowledge: classes.includes("technical_production"),
    requiresLocalRelevance: classes.includes("local_commercial"),
    reasons
  };
}
