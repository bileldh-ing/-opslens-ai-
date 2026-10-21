import { describe, expect, it } from "vitest";
import { focusOnQuestion, focusTerms, rootCauseFirst } from "@/server/ai/triage";

const g = (title: string, service: string, occurrences: number) => ({ title, service, occurrences });

describe("triage ranking", () => {
  it("puts the source service before downstream symptoms", () => {
    const ranked = rootCauseFirst([
      g("upstream payment-service returned <n> for order <n>", "checkout-api", 50),
      g("paymentgatewaytimeout after <n>ms", "payment-service", 20),
    ]);
    expect(ranked[0].service).toBe("payment-service");
  });

  it("focuses on the error the question is about", () => {
    const ranked = focusOnQuestion(
      [g("gateway timeout", "payment-service", 200), g("connection pool exhausted", "payment-service", 10)],
      "Is the connection pool related to the failures?",
    );
    expect(ranked[0].title).toMatch(/pool/);
  });

  it("ignores generic and service words when extracting focus terms", () => {
    expect(focusTerms("Why did payment service errors start after the deploy?", ["payment"])).toEqual([]);
    expect(focusTerms("database connection pool exhausted")).toEqual(["database", "connection", "pool", "exhausted"]);
  });
});
