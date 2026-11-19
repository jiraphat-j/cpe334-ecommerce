import { describe, it, expect } from "vitest";
import { parseAndValidateQuantity } from "./utils/orderValidation";

describe("UAT Defect Issue #26: Order Quantity Boundary Validation (Issue A02)", () => {
  it("TEST-A02-01: should reject quantity 0 with an error instead of silently auto-converting to 1", () => {
    const result = parseAndValidateQuantity("0");
    expect(result.valid).toBe(false);
    expect(result.error).toBe("Quantity must be at least 1.");
    expect(result.quantity).not.toBe(1);
  });

  it("TEST-A02-02: should reject negative quantity -1 with an error instead of converting or placing order", () => {
    const result = parseAndValidateQuantity("-1");
    expect(result.valid).toBe(false);
    expect(result.error).toBe("Quantity must be at least 1.");
  });

  it("TEST-A02-03: should accept valid positive integer quantity like 2", () => {
    const result = parseAndValidateQuantity("2");
    expect(result.valid).toBe(true);
    expect(result.quantity).toBe(2);
  });
});
