import { ENTREPRENEURSHIP_INTERVIEW_QUESTIONS } from "./pillars.js";
import type { MerchantInterview } from "./types.js";

export function createInterviewDraft(briefId: number, questions?: string[]): MerchantInterview {
  const list = (questions?.length ? questions : ENTREPRENEURSHIP_INTERVIEW_QUESTIONS).slice(0, 10);
  return {
    briefId,
    completed: false,
    questions: list.map((question, index) => ({
      id: `q${index + 1}`,
      question,
      answer: null
    }))
  };
}

export function applyInterviewAnswers(
  interview: MerchantInterview,
  answers: Record<string, string>
): MerchantInterview {
  const questions = interview.questions.map(q => ({
    ...q,
    answer: (answers[q.id] ?? q.answer ?? "").trim() || null
  }));
  const completed = questions.every(q => q.answer && q.answer.length >= 8);
  return { ...interview, questions, completed };
}

export function interviewAnswersAsFacts(interview: MerchantInterview): string[] {
  return interview.questions
    .filter(q => q.answer)
    .map(q => `Merchant answer to “${q.question}”: ${q.answer}`);
}

export function assertNoInventedPersonalExperience(bodyHtml: string, allowedFacts: string[]): string[] {
  const flags: string[] = [];
  const text = bodyHtml.replace(/<[^>]+>/g, " ");
  const patterns = [
    /I made \$\d+/i,
    /my revenue hit/i,
    /I hired \d+ employees/i,
    /I quit my job at [A-Z][a-z]+/i
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (!m) continue;
    const snippet = m[0];
    const allowed = allowedFacts.some(f => f.toLowerCase().includes(snippet.toLowerCase().slice(0, 12)));
    if (!allowed) flags.push(`Possible invented personal detail: ${snippet}`);
  }
  return flags;
}
