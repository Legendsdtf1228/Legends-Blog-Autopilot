/**
 * Reusable service/terminology constraints for every article.
 */

export interface TechnicalFinding {
  gate: string;
  severity: "critical" | "major" | "minor";
  detail: string;
}

export function assessTechnicalAccuracy(bodyHtml: string): TechnicalFinding[] {
  const findings: TechnicalFinding[] = [];
  const text = bodyHtml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  const lower = text.toLowerCase();

  const uvMention = /\buv\s*dtf\b/i.test(text);
  if (uvMention) {
    const treatsAsApparel =
      /\buv\s*dtf\b[\s\S]{0,100}\b(garment|apparel|shirt|hoodie|embroidery|fabric)\b/i.test(text) ||
      /\b(garment|apparel|shirt|hoodie)\b[\s\S]{0,100}\buv\s*dtf\b/i.test(text);
    const pressGuidance =
      /\buv\s*dtf\b[\s\S]{0,120}\b(press|pressing|heat press|temperature|pressure)\b/i.test(text) ||
      /\b(press|pressing|heat press)\b[\s\S]{0,120}\buv\s*dtf\b/i.test(text);

    if (treatsAsApparel) {
      findings.push({
        gate: "uv_dtf_service_category",
        severity: "critical",
        detail: "UV DTF is for compatible hard surfaces, not apparel decoration / garment production."
      });
    }
    if (pressGuidance) {
      findings.push({
        gate: "uv_dtf_pressing_guidance",
        severity: "critical",
        detail: "Heat pressing applies to suitable garment transfers, not ordinary UV DTF application."
      });
    }
  }

  // Interchangeable service categories
  if (
    /\b(screen print(ing)?|embroidery|dtf|uv dtf|finished apparel)\b/i.test(text) &&
    /\b(interchangeable|same as|just like|equivalent to|all the same)\b/i.test(text) &&
    /\b(screen print|embroidery|dtf|uv dtf)\b[\s\S]{0,80}\b(screen print|embroidery|dtf|uv dtf)\b/i.test(text)
  ) {
    findings.push({
      gate: "service_category_interchangeable",
      severity: "major",
      detail: "Screen printing, embroidery, DTF, finished apparel, and UV DTF must not be presented as interchangeable."
    });
  }

  // Printer-pass vs transfer application confusion
  if (/\bprinter pass(es)?\b/i.test(text) && /\b(heat press|press onto|apply(ing)? (the )?transfer)\b/i.test(text)) {
    if (/\bprinter pass[\s\S]{0,60}\b(heat press|press onto fabric|apply)\b/i.test(text)) {
      findings.push({
        gate: "printer_pass_confusion",
        severity: "major",
        detail: "Printer-pass terminology must not be confused with transfer application."
      });
    }
  }

  // Unqualified proof promises
  if (/\b(we (always )?send|guaranteed|free)\b[\s\S]{0,40}\bproofs?\b|\bproofs?\b[\s\S]{0,40}\b(always|guaranteed|every order)\b/i.test(text)) {
    findings.push({
      gate: "unqualified_proof_promise",
      severity: "major",
      detail: "Proofs must not be promised unless the relevant workflow actually includes them."
    });
  }

  // Generic resolution claims without final-output-size context
  if (/\b(300\s*dpi|high resolution)\b/i.test(text) && !/\b(final output|print size|at size|actual size)\b/i.test(text)) {
    findings.push({
      gate: "resolution_without_output_size",
      severity: "minor",
      detail: "Resolution should be evaluated at final output size."
    });
  }

  // Live price/availability claims without current-source language
  if (
    /\$\d|\b(our price is|currently costs?|in stock now|always available)\b/i.test(text) &&
    !/\b(check current|current (price|availability)|approved (price|source)|as of)\b/i.test(text)
  ) {
    findings.push({
      gate: "live_commerce_without_source",
      severity: "critical",
      detail: "Live prices, availability, turnaround, and policies require current approved sources."
    });
  }

  // Same-day / invented guarantee language (shared with editorial)
  if (/\b(same-day|guaranteed turnaround|always in stock)\b/i.test(lower)) {
    findings.push({
      gate: "unsupported_commerce_guarantee",
      severity: "critical",
      detail: "Unsupported same-day / always-in-stock / guarantee language."
    });
  }

  return findings;
}
