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
  id: "cust-1",
  email: "cust@example.com",
  role: "CUSTOMER",
})}`;

const operatorToken = `Bearer ${generateToken({
  id: "op-1",
  email: "op@example.com",
  role: "OPERATOR",
})}`;

const otherCustomerToken = `Bearer ${generateToken({
  id: "cust-2",
  email: "other@example.com",
  role: "CUSTOMER",
})}`;

const prod1 = { id: "p1", name: "Keyboard", price: 1500, stock: 10, archived_at: null };
const prod2 = { id: "p2", name: "Mouse", price: 800, stock: 5, archived_at: null };

describe("F-06 Atomic multi-item cart checkout", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  // TEST-F06-01: Successful two-item checkout
  it("TEST-F06-01: successfully checks out multiple distinct cart items atomically", async () => {
    vi.mocked(prisma.$transaction).mockImplementation(async (callback) => {
      const tx = {
        product: {
          findUnique: vi.fn().mockImplementation(({ where }: { where: { id: string } }) => {
            if (where.id === "p1") return Promise.resolve(prod1);
            if (where.id === "p2") return Promise.resolve(prod2);
            return Promise.resolve(null);
          }),
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        },
        order: {
          create: vi.fn().mockImplementation(({ data }: { data: any }) => {
            return Promise.resolve({
              id: "order-multi-1",
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

    const res = await request(app)
      .post("/api/orders")
      .set("Authorization", customerToken)
      .send({
        items: [
          { productId: "p1", quantity: 2 },
          { productId: "p2", quantity: 1 },
        ],
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.order).toBeDefined();
    expect(res.body.data.order.total_amount).toBe(3800); // 1500*2 + 800*1
    expect(res.body.data.order.items).toHaveLength(2);
  });

  // TEST-F06-02: Rejection & atomic rollback
  it("TEST-F06-02: rejects empty cart or malformed item payloads", async () => {
    // Empty array
    const resEmpty = await request(app)
      .post("/api/orders")
      .set("Authorization", customerToken)
      .send({ items: [] });
    expect(resEmpty.status).toBe(400);

    // Invalid quantity (0 or negative)
    const resZero = await request(app)
      .post("/api/orders")
      .set("Authorization", customerToken)
      .send({ items: [{ productId: "p1", quantity: 0 }] });
    expect(resZero.status).toBe(400);

    const resFraction = await request(app)
      .post("/api/orders")
      .set("Authorization", customerToken)
      .send({ items: [{ productId: "p1", quantity: 1.5 }] });
    expect(resFraction.status).toBe(400);

    // Aggregated quantity exceeding limit / integer bounds
    const resOverflow = await request(app)
      .post("/api/orders")
      .set("Authorization", customerToken)
      .send({
        items: [
          { productId: "p1", quantity: 2_000_000_000 },
          { productId: "p1", quantity: 1_000_000_000 },
        ],
      });
    expect(resOverflow.status).toBe(400);
    expect(resOverflow.body.error.code).toBe("INVALID_QUANTITY");
  });

  it("TEST-F06-02: rejects and rolls back if an item is archived or missing", async () => {
    vi.mocked(prisma.$transaction).mockImplementation(async (callback) => {
      const tx = {
        product: {
          findUnique: vi.fn().mockImplementation(({ where }: { where: { id: string } }) => {
            if (where.id === "p1") return Promise.resolve(prod1);
            if (where.id === "p-archived") return Promise.resolve({ ...prod2, id: "p-archived", archived_at: new Date() });
            return Promise.resolve(null);
          }),
          updateMany: vi.fn().mockImplementation(({ where }: { where: any }) => {
            if (where.id === "p-archived") return Promise.resolve({ count: 0 });
            return Promise.resolve({ count: 1 });
          }),
        },
        order: { create: vi.fn() },
      };
      return (callback as (client: any) => Promise<any>)(tx);
    });

    const resArchived = await request(app)
      .post("/api/orders")
      .set("Authorization", customerToken)
      .send({
        items: [
          { productId: "p1", quantity: 1 },
          { productId: "p-archived", quantity: 1 },
        ],
      });

    expect(resArchived.status).toBe(409);
    expect(resArchived.body.error.code).toBe("PRODUCT_ARCHIVED");

    // Missing product
    const resMissing = await request(app)
      .post("/api/orders")
      .set("Authorization", customerToken)
      .send({
        items: [
          { productId: "p1", quantity: 1 },
          { productId: "p-missing", quantity: 1 },
        ],
      });
    expect(resMissing.status).toBe(404);
    expect(resMissing.body.error.code).toBe("PRODUCT_NOT_FOUND");
  });

  it("TEST-F06-02: rolls back atomically when second item has insufficient stock", async () => {
    vi.mocked(prisma.$transaction).mockImplementation(async (callback) => {
      const tx = {
        product: {
          findUnique: vi.fn().mockImplementation(({ where }: { where: { id: string } }) => {
            if (where.id === "p1") return Promise.resolve(prod1);
            if (where.id === "p2") return Promise.resolve(prod2); // stock is 5
            return Promise.resolve(null);
          }),
          updateMany: vi.fn().mockImplementation(({ where }: { where: any }) => {
            if (where.id === "p1") return Promise.resolve({ count: 1 });
            if (where.id === "p2") return Promise.resolve({ count: 0 }); // out of stock
            return Promise.resolve({ count: 0 });
          }),
        },
        order: { create: vi.fn() },
      };
      return (callback as (client: any) => Promise<any>)(tx);
    });

    const res = await request(app)
      .post("/api/orders")
      .set("Authorization", customerToken)
      .send({
        items: [
          { productId: "p1", quantity: 1 },
          { productId: "p2", quantity: 5 }, // within 5-unit limit, but exceeds available stock
        ],
      });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INSUFFICIENT_STOCK");
  });

  // TEST-F06-03: Concurrency & Deadlock Prevention (Reviewer P1)
  it("TEST-F06-03: acquires row locks in deterministic sorted productId order to prevent deadlocks (40P01)", async () => {
    const lockOrder: string[] = [];
    vi.mocked(prisma.$transaction).mockImplementation(async (callback) => {
      const tx = {
        product: {
          findUnique: vi.fn().mockImplementation(({ where }: { where: { id: string } }) => {
            if (where.id === "p1") return Promise.resolve(prod1);
            if (where.id === "p2") return Promise.resolve(prod2);
            return Promise.resolve(null);
          }),
          updateMany: vi.fn().mockImplementation(({ where }: { where: { id: string } }) => {
            lockOrder.push(where.id);
            return Promise.resolve({ count: 1 });
          }),
        },
        order: {
          create: vi.fn().mockResolvedValue({
            id: "order-sorted",
            total_amount: 3800,
            items: [],
          }),
        },
      };
      return (callback as (client: any) => Promise<any>)(tx);
    });

    // Request sent with items in reverse order: [p2, p1]
    const res = await request(app)
      .post("/api/orders")
      .set("Authorization", customerToken)
      .send({
        items: [
          { productId: "p2", quantity: 1 },
          { productId: "p1", quantity: 2 },
        ],
      });

    expect(res.status).toBe(201);
    // Verified: locks must be acquired in sorted order: ["p1", "p2"] regardless of payload sequence
    expect(lockOrder).toEqual(["p1", "p2"]);
  });

  // TEST-F06-04: Role protection and order isolation
  it("TEST-F06-04: rejects unauthenticated requests (401) and Operator order placement (403)", async () => {
    const unauth = await request(app)
      .post("/api/orders")
      .send({ items: [{ productId: "p1", quantity: 1 }] });
    expect(unauth.status).toBe(401);

    const operatorReq = await request(app)
      .post("/api/orders")
      .set("Authorization", operatorToken)
      .send({ items: [{ productId: "p1", quantity: 1 }] });
    expect(operatorReq.status).toBe(403);
  });

  it("TEST-F06-04: Customer can retrieve their multi-item order, other customer gets 403", async () => {
    const mockOrder = {
      id: "order-multi-1",
      customer_id: "cust-1",
      status: OrderStatus.PENDING,
      total_amount: 3800,
      items: [
        { id: "item-1", product_id: "p1", quantity: 2, unit_price: 1500 },
        { id: "item-2", product_id: "p2", quantity: 1, unit_price: 800 },
      ],
    };

    vi.mocked(prisma.order.findUnique).mockResolvedValue(mockOrder as any);

    // Owner gets 200
    const ownerRes = await request(app)
      .get("/api/orders/order-multi-1")
      .set("Authorization", customerToken);
    expect(ownerRes.status).toBe(200);
    expect(ownerRes.body.data.order.items).toHaveLength(2);

    // Another customer gets 403
    const strangerRes = await request(app)
      .get("/api/orders/order-multi-1")
      .set("Authorization", otherCustomerToken);
    expect(strangerRes.status).toBe(403);
  });

  // TEST-F06-05: Single-item purchase compatibility
  it("TEST-F06-05: preserves backward compatibility with single-item payload", async () => {
    vi.mocked(prisma.$transaction).mockImplementation(async (callback) => {
      const tx = {
        product: {
          findUnique: vi.fn().mockResolvedValue(prod1),
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        },
        order: {
          create: vi.fn().mockResolvedValue({
            id: "order-single-1",
            customer_id: "cust-1",
            status: OrderStatus.PENDING,
            total_amount: 1500,
            items: [{ id: "item-1", product_id: "p1", quantity: 1, unit_price: 1500 }],
          }),
        },
      };
      return (callback as (client: any) => Promise<any>)(tx);
    });

    const res = await request(app)
      .post("/api/orders")
      .set("Authorization", customerToken)
      .send({ productId: "p1", quantity: 1 });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.order.total_amount).toBe(1500);
  });
});
