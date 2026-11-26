import { beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { app } from "../src/app.js";
import { generateToken } from "../src/middleware/auth.js";
import { prisma } from "../src/prisma.js";
import { OrderStatus } from "@prisma/client";

vi.mock("../src/prisma.js", () => ({
  prisma: {
    $transaction: vi.fn(),
    product: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      updateMany: vi.fn(),
    },
    order: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
    },
    orderItem: {
      create: vi.fn(),
    },
  },
}));

const customerToken = `Bearer ${generateToken({
  id: "cust-lab7-1",
  email: "customer7@example.com",
  role: "CUSTOMER",
})}`;

const prodA = { id: "prod-A", name: "Wireless Mechanical Keyboard", price: 1500, stock: 20, archived_at: null };
const prodB = { id: "prod-B", name: "Ergonomic Gaming Mouse", price: 800, stock: 20, archived_at: null };
const prodLowStock = { id: "prod-Low", name: "Limited Edition Keycap", price: 500, stock: 4, archived_at: null };

describe("Lab 7 Maintenance (CR-LAB7-01 / #51): Per-Product Purchase Limit (BR-LIMIT-05)", () => {
  let updateManySpy: any;

  beforeEach(() => {
    vi.resetAllMocks();
  });

  // Helper to mock successful atomic transaction
  function mockTransactionSuccess(stockMap: Record<string, any>) {
    updateManySpy = vi.fn().mockImplementation(({ where, data }: { where: any; data: any }) => {
      const product = stockMap[where.id];
      if (!product) return Promise.resolve({ count: 0 });
      if (where.stock?.gte !== undefined && product.stock < where.stock.gte) {
        return Promise.resolve({ count: 0 });
      }
      return Promise.resolve({ count: 1 });
    });

    vi.mocked(prisma.$transaction).mockImplementation(async (callback) => {
      const tx = {
        product: {
          findUnique: vi.fn().mockImplementation(({ where }: { where: { id: string } }) => {
            return Promise.resolve(stockMap[where.id] || null);
          }),
          updateMany: updateManySpy,
        },
        order: {
          create: vi.fn().mockImplementation(({ data }: { data: any }) => {
            return Promise.resolve({
              id: "order-lab7-mock",
              customer_id: data.customer_id,
              status: OrderStatus.PENDING,
              total_amount: data.total_amount,
              items: data.items.create.map((item: any, idx: number) => ({
                id: `item-${idx + 1}`,
                ...item,
              })),
            });
          }),
        },
      };
      return (callback as (client: any) => Promise<any>)(tx);
    });
  }

  // TEST-L7-01: Exact boundary (5 units) passes via legacy Buy Now payload and decrements stock from 10 to 5
  it("TEST-L7-01: accepts legacy Buy Now order with exactly 5 units and decrements stock", async () => {
    mockTransactionSuccess({ "prod-A": prodA });

    const res = await request(app)
      .post("/api/orders")
      .set("Authorization", customerToken)
      .send({
        productId: "prod-A",
        quantity: 5,
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.order).toBeDefined();
    expect(res.body.data.order.items).toHaveLength(1);
    expect(res.body.data.order.items[0].quantity).toBe(5);
    expect(updateManySpy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: "prod-A", stock: { gte: 5 } }),
        data: { stock: { decrement: 5 } },
      })
    );
  });

  // TEST-L7-02: Exceeding 5 units (6 units) must be rejected with 400 ORDER_QUANTITY_LIMIT_EXCEEDED
  it("TEST-L7-02: rejects order with 6 units of a single product with 400 ORDER_QUANTITY_LIMIT_EXCEEDED", async () => {
    mockTransactionSuccess({ "prod-A": prodA });

    const res = await request(app)
      .post("/api/orders")
      .set("Authorization", customerToken)
      .send({
        items: [{ productId: "prod-A", quantity: 6 }],
      });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe("ORDER_QUANTITY_LIMIT_EXCEEDED");
    // Ensure no database transaction / write was executed
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  // TEST-L7-03: Multi-item payload with duplicated SKU aggregating to >5 units (3 + 3 = 6) must be rejected
  it("TEST-L7-03: rejects cart with duplicated same SKU combining to 6 units with ORDER_QUANTITY_LIMIT_EXCEEDED", async () => {
    mockTransactionSuccess({ "prod-A": prodA });

    const res = await request(app)
      .post("/api/orders")
      .set("Authorization", customerToken)
      .send({
        items: [
          { productId: "prod-A", quantity: 3 },
          { productId: "prod-A", quantity: 3 },
        ],
      });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe("ORDER_QUANTITY_LIMIT_EXCEEDED");
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  // TEST-L7-04: Distinct products each <= 5 units (3 of A + 3 of B) passes
  it("TEST-L7-04: accepts cart with distinct products each within 5 units (3 of A + 3 of B)", async () => {
    mockTransactionSuccess({ "prod-A": prodA, "prod-B": prodB });

    const res = await request(app)
      .post("/api/orders")
      .set("Authorization", customerToken)
      .send({
        items: [
          { productId: "prod-A", quantity: 3 },
          { productId: "prod-B", quantity: 3 },
        ],
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.order.items).toHaveLength(2);
  });

  // TEST-L7-05: When quantity is 5 but stock is 4, responds with 400 INSUFFICIENT_STOCK
  it("TEST-L7-05: rejects with INSUFFICIENT_STOCK when quantity is 5 but stock is 4", async () => {
    mockTransactionSuccess({ "prod-Low": prodLowStock });

    const res = await request(app)
      .post("/api/orders")
      .set("Authorization", customerToken)
      .send({
        items: [{ productId: "prod-Low", quantity: 5 }],
      });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe("INSUFFICIENT_STOCK");
  });

  // TEST-L7-06: Backward compatible single-item payload with quantity 6 rejects with ORDER_QUANTITY_LIMIT_EXCEEDED
  it("TEST-L7-06: rejects single-item legacy payload with quantity 6", async () => {
    mockTransactionSuccess({ "prod-A": prodA });

    const res = await request(app)
      .post("/api/orders")
      .set("Authorization", customerToken)
      .send({
        productId: "prod-A",
        quantity: 6,
      });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe("ORDER_QUANTITY_LIMIT_EXCEEDED");
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  // TEST-L7-07: Mixed cart containing a valid line (prod-B: 2) and an over-limit line (prod-A: 6) rejects with no writes
  it("TEST-L7-07: rejects mixed cart containing a valid line and an over-limit line with no transaction/writes", async () => {
    mockTransactionSuccess({ "prod-A": prodA, "prod-B": prodB });

    const res = await request(app)
      .post("/api/orders")
      .set("Authorization", customerToken)
      .send({
        items: [
          { productId: "prod-B", quantity: 2 },
          { productId: "prod-A", quantity: 6 },
        ],
      });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe("ORDER_QUANTITY_LIMIT_EXCEEDED");
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
