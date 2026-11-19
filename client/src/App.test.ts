import { describe, it, expect } from "vitest";
import { parseAndValidateQuantity } from "./utils/orderValidation";
import {
  getInitialAuthState,
  shouldAutoLoginPrivilegedOnLoad,
  resetSessionOnLogout,
  clearOrdersOnAccountSwitch,
  type UserSessionState,
} from "./utils/authSession";

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

describe("UAT Defect Issue #27: Security Vulnerability & State Reset (Issue A03)", () => {
  it("TEST-A03-01: should initialize in guest state and reject automatic privileged operator elevation on load", () => {
    expect(shouldAutoLoginPrivilegedOnLoad()).toBe(false);
    const initial = getInitialAuthState();
    expect(initial.currentUser).toBeNull();
    expect(initial.token).toBe("");
    expect(initial.activeTab).toBe("catalog");
  });

  it("TEST-A03-02: should completely clear myOrders, operatorOrders, and token on logout", () => {
    const activeSession: UserSessionState = {
      currentUser: { id: "cust-1", email: "alice@customer.com", role: "CUSTOMER" },
      token: "valid-token-123",
      activeTab: "my-orders",
      myOrders: [{ id: "order-1", total: 100 }],
      operatorOrders: [{ id: "order-2", total: 200 }],
    };

    const loggedOut = resetSessionOnLogout(activeSession);
    expect(loggedOut.currentUser).toBeNull();
    expect(loggedOut.token).toBe("");
    expect(loggedOut.myOrders).toEqual([]);
    expect(loggedOut.operatorOrders).toEqual([]);
    expect(loggedOut.activeTab).toBe("catalog");
  });

  it("TEST-A03-03: should clear previous user orders when switching accounts to prevent state leakage", () => {
    const aliceSession = {
      currentUser: { id: "cust-1", email: "alice@customer.com", role: "CUSTOMER" as const },
      token: "alice-token",
      activeTab: "my-orders" as const,
      myOrders: [{ id: "alice-order-1", total: 50 }],
      operatorOrders: [],
    };

    const switchedSession = clearOrdersOnAccountSwitch(aliceSession);
    expect(switchedSession.myOrders).toEqual([]);
    expect(switchedSession.myOrders.length).toBe(0);
  });
});
