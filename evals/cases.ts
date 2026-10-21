/**
 * Golden investigation cases. Each runs the real agent against the seeded demo project
 * and is graded on grounding, not wording.
 */
export type EvalCase = {
  name: string;
  question: string;
  expect: {
    status: Array<"likely_cause_found" | "inconclusive" | "insufficient_data">;
    topCauseMentions?: RegExp; // the top hypothesis should name this
    mustCite?: Array<"log" | "doc" | "incident" | "deployment">;
    maxConfidence?: number; // for questions where the honest answer is "we don't know"
  };
};

export const CASES: EvalCase[] = [
  {
    name: "payment 500s after deploy → timeout regression",
    question: "Why did our payment service start returning 500 errors after the last deployment?",
    expect: {
      status: ["likely_cause_found"],
      topCauseMentions: /timeout|2\s?s|2000\s?ms/i,
      mustCite: ["log", "deployment"],
    },
  },
  {
    name: "pool exhaustion is recognized as contributing",
    question: "Is the database connection pool related to the payment failures?",
    expect: { status: ["likely_cause_found", "inconclusive"], topCauseMentions: /pool/i, mustCite: ["log"] },
  },
  {
    name: "no data → admits uncertainty instead of inventing",
    question: "Why is the search-indexer service leaking memory?",
    expect: { status: ["insufficient_data", "inconclusive"], maxConfidence: 0.3 },
  },
];
