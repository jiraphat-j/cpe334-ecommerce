import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import { app } from "../src/app.js";
import { prisma } from "../src/prisma.js";
import { generateToken } from "../src/middleware/auth.js";
import { OrderStatus } from "@prisma/client";

// Mock Prisma client for deterministic testing
vi.mock("../src/prisma.js", () => {
  return {
    prisma: {
      order: {
        findMany: vi.fn(),
        findUnique: vi.fn(),
        update: vi.fn(),
      },
    },
  };
});

describe("Issue #4: Operator Order Management & Status Transitions (F-04)", () => {
  const operatorToken = generateToken({
    id: "op-1",
    email: "operator@store.com",
    role: "OPERATOR",
  });

  const customerToken = generateToken({
    id: "cust-1",
    email: "customer@example.com",
    role: "CUSTOMER",
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // TEST-10: Operator View All Orders (AC-08, FR-06)
  it("TEST-10: GET /api/operator/orders should return all orders for Operator", async () => {
    const mockAllOrders = [
      {
        id: "order-1",
        customer_id: "cust-1",
        total_amount: 1500,
        status: OrderStatus.PENDING,
        created_at: new Date(),
        customer: { id: "cust-1", email: "alice@customer.com", role: "CUSTOMER" },
        items: [{ id: "item-1", product_id: "prod-1", quantity: 1, unit_price: 1500, product: { name: "Keyboard" } }],
      },
      {
        id: "order-2",
        customer_id: "cust-2",
        total_amount: 800,
        status: OrderStatus.CONFIRMED,
        created_at: new Date(),
        customer: { id: "cust-2", email: "bob@customer.com", role: "CUSTOMER" },
        items: [{ id: "item-2", product_id: "prod-2", quantity: 1, unit_price: 800, product: { name: "Mouse" } }],
      },
    ];
    (prisma.order.findMany as any).mockResolvedValue(mockAllOrders);

    const res = await request(app)
      .get("/api/operator/orders")
      .set("Authorization", `Bearer ${operatorToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.orders).toHaveLength(2);
    expect(res.body.data.orders[0].customer.email).toBe("alice@customer.com");
  });

  // TEST-13: Access Control Restriction (AC-08, BR-06)
  it("TEST-13: Customer calling GET /api/operator/orders must receive 403 Forbidden", async () => {
    const res = await request(app)
      .get("/api/operator/orders")
      .set("Authorization", `Bearer ${customerToken}`);

    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe("FORBIDDEN");
  });

  // TEST-14: Unauthenticated Request Guard (NFR-01)
  it("TEST-14: Unauthenticated call to /api/operator/orders must return 401 Unauthorized", async () => {
    const res = await request(app).get("/api/operator/orders");

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHORIZED");
  });

  // TEST-11: Valid Transition PENDING -> CONFIRMED (AC-09, FR-07)
  it("TEST-11: Operator can transition order from PENDING to CONFIRMED", async () => {
    (prisma.order.findUnique as any).mockResolvedValue({
      id: "order-1",
      customer_id: "cust-1",
      status: OrderStatus.PENDING,
    });
    (prisma.order.update as any).mockResolvedValue({
      id: "order-1",
      customer_id: "cust-1",
      status: OrderStatus.CONFIRMED,
    });

    const res = await request(app)
      .patch("/api/operator/orders/order-1/status")
      .set("Authorization", `Bearer ${operatorToken}`)
      .send({ status: OrderStatus.CONFIRMED });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.order.status).toBe(OrderStatus.CONFIRMED);
  });

  // TEST-11b: Valid Transition PENDING -> CANCELLED (AC-09, FR-07)
  it("TEST-11b: Operator can transition order from PENDING to CANCELLED", async () => {
    (prisma.order.findUnique as any).mockResolvedValue({
      id: "order-1",
      customer_id: "cust-1",
      status: OrderStatus.PENDING,
    });
    (prisma.order.update as any).mockResolvedValue({
      id: "order-1",
      customer_id: "cust-1",
      status: OrderStatus.CANCELLED,
    });

    const res = await request(app)
      .patch("/api/operator/orders/order-1/status")
      .set("Authorization", `Bearer ${operatorToken}`)
      .send({ status: OrderStatus.CANCELLED });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.order.status).toBe(OrderStatus.CANCELLED);
  });

  // TEST-12: Invalid Transition Rejection from CANCELLED (AC-10, BR-05)
  it("TEST-12: Operator attempting to reactivate CANCELLED order must be rejected with 400", async () => {
    (prisma.order.findUnique as any).mockResolvedValue({
      id: "order-1",
      customer_id: "cust-1",
      status: OrderStatus.CANCELLED,
    });

    const res = await request(app)
      .patch("/api/operator/orders/order-1/status")
      .set("Authorization", `Bearer ${operatorToken}`)
      .send({ status: OrderStatus.CONFIRMED });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe("INVALID_TRANSITION");
  });

  // TEST-12b: Order Not Found (AC-09, BR-05)
  it("TEST-12b: PATCH status with non-existent order ID returns 404 Not Found", async () => {
    (prisma.order.findUnique as any).mockResolvedValue(null);

    const res = await request(app)
      .patch("/api/operator/orders/non-existent-order/status")
      .set("Authorization", `Bearer ${operatorToken}`)
      .send({ status: OrderStatus.CONFIRMED });

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("ORDER_NOT_FOUND");
  });

  // TEST-12c: Invalid Status Parameter (AC-10)
  it("TEST-12c: PATCH status with invalid status value returns 400 Bad Request", async () => {
    const res = await request(app)
      .patch("/api/operator/orders/order-1/status")
      .set("Authorization", `Bearer ${operatorToken}`)
      .send({ status: "INVALID_STATUS_VALUE" });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_STATUS");
  });

  // TEST-13b: Customer attempting to patch operator status gets 403 Forbidden
  it("TEST-13b: Customer attempting to update order status must receive 403 Forbidden", async () => {
    const res = await request(app)
      .patch("/api/operator/orders/order-1/status")
      .set("Authorization", `Bearer ${customerToken}`)
      .send({ status: OrderStatus.CONFIRMED });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FORBIDDEN");
  });
});
