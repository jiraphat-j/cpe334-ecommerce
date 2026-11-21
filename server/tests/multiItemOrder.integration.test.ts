import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "../src/app.js";
import { prisma } from "../src/prisma.js";
import { generateToken } from "../src/middleware/auth.js";

describe("AC-F06-03 (Integration): Concurrent multi-item checkout on PostgreSQL", () => {
  const userA = { id: "integ-user-a", email: "integ-a@example.com", role: "CUSTOMER" as const };
  const userB = { id: "integ-user-b", email: "integ-b@example.com", role: "CUSTOMER" as const };

  const tokenA = `Bearer ${generateToken(userA)}`;
  const tokenB = `Bearer ${generateToken(userB)}`;

  const prodAId = "integ-prod-a";
  const prodBId = "integ-prod-b";

  beforeAll(async () => {
    // Assert live PostgreSQL connection; propagate error if DB is unreachable to fail CI
    await prisma.$queryRaw`SELECT 1`;

    // Seed / ensure test users exist
    await prisma.user.upsert({
      where: { id: userA.id },
      update: { email: userA.email, role: userA.role },
      create: { id: userA.id, email: userA.email, password_hash: "hash", role: userA.role },
    });
    await prisma.user.upsert({
      where: { id: userB.id },
      update: { email: userB.email, role: userB.role },
      create: { id: userB.id, email: userB.email, password_hash: "hash", role: userB.role },
    });

    // Upsert test products with active status
    await prisma.product.upsert({
      where: { id: prodAId },
      update: { name: "Integration Product A", price: 100, stock: 10, archived_at: null },
      create: { id: prodAId, name: "Integration Product A", price: 100, stock: 10, archived_at: null },
    });
    await prisma.product.upsert({
      where: { id: prodBId },
      update: { name: "Integration Product B", price: 200, stock: 10, archived_at: null },
      create: { id: prodBId, name: "Integration Product B", price: 200, stock: 10, archived_at: null },
    });
  });

  afterAll(async () => {
    try {
      await prisma.orderItem.deleteMany({
        where: { product_id: { in: [prodAId, prodBId] } },
      });
      await prisma.order.deleteMany({
        where: { customer_id: { in: [userA.id, userB.id] } },
      });
      await prisma.product.deleteMany({
        where: { id: { in: [prodAId, prodBId] } },
      });
      await prisma.user.deleteMany({
        where: { id: { in: [userA.id, userB.id] } },
      });
    } catch (err) {
      console.warn("Integration cleanup error:", err);
    } finally {
      await prisma.$disconnect();
    }
  });

  it("TEST-F06-03 (Live DB): both requests get 201 when stock is sufficient with opposite ordering [A, B] and [B, A]", async () => {
    // Reset stock to 10 each
    await prisma.product.update({ where: { id: prodAId }, data: { stock: 10 } });
    await prisma.product.update({ where: { id: prodBId }, data: { stock: 10 } });

    // Count existing orders for test users
    const initialOrdersCount = await prisma.order.count({
      where: { customer_id: { in: [userA.id, userB.id] } },
    });

    // Fire concurrently with opposite product ordering: [A, B] vs [B, A]
    const req1 = request(app)
      .post("/api/orders")
      .set("Authorization", tokenA)
      .send({
        items: [
          { productId: prodAId, quantity: 2 },
          { productId: prodBId, quantity: 1 },
        ],
      });

    const req2 = request(app)
      .post("/api/orders")
      .set("Authorization", tokenB)
      .send({
        items: [
          { productId: prodBId, quantity: 2 },
          { productId: prodAId, quantity: 1 },
        ],
      });

    const [res1, res2] = await Promise.all([req1, req2]);

    expect(res1.status).toBe(201);
    expect(res2.status).toBe(201);
    expect(res1.body.success).toBe(true);
    expect(res2.body.success).toBe(true);

    // Final stock check
    const prodA = await prisma.product.findUnique({ where: { id: prodAId } });
    const prodB = await prisma.product.findUnique({ where: { id: prodBId } });

    // Product A: 10 - 2 - 1 = 7
    expect(prodA?.stock).toBe(7);
    // Product B: 10 - 1 - 2 = 7
    expect(prodB?.stock).toBe(7);

    // Total orders check: exactly 2 new orders
    const finalOrdersCount = await prisma.order.count({
      where: { customer_id: { in: [userA.id, userB.id] } },
    });
    expect(finalOrdersCount - initialOrdersCount).toBe(2);
  });

  it("TEST-F06-03 (Live DB): when stock is only enough for one set, one gets 201 and the other gets 400 INSUFFICIENT_STOCK", async () => {
    // Set stock to exactly 1 for both products (only enough for 1 order of { quantity: 1 })
    await prisma.product.update({ where: { id: prodAId }, data: { stock: 1 } });
    await prisma.product.update({ where: { id: prodBId }, data: { stock: 1 } });

    const initialOrdersCount = await prisma.order.count({
      where: { customer_id: { in: [userA.id, userB.id] } },
    });

    // Fire concurrently with opposite product ordering: [A, B] vs [B, A]
    const req1 = request(app)
      .post("/api/orders")
      .set("Authorization", tokenA)
      .send({
        items: [
          { productId: prodAId, quantity: 1 },
          { productId: prodBId, quantity: 1 },
        ],
      });

    const req2 = request(app)
      .post("/api/orders")
      .set("Authorization", tokenB)
      .send({
        items: [
          { productId: prodBId, quantity: 1 },
          { productId: prodAId, quantity: 1 },
        ],
      });

    const [res1, res2] = await Promise.all([req1, req2]);

    const statuses = [res1.status, res2.status].sort();
    expect(statuses).toEqual([201, 400]);

    const failedRes = res1.status === 400 ? res1 : res2;
    const successRes = res1.status === 201 ? res1 : res2;

    expect(failedRes.body.success).toBe(false);
    expect(failedRes.body.error.code).toBe("INSUFFICIENT_STOCK");
    expect(successRes.body.success).toBe(true);

    // Final stock check: exactly 0 for both products, never negative
    const prodA = await prisma.product.findUnique({ where: { id: prodAId } });
    const prodB = await prisma.product.findUnique({ where: { id: prodBId } });

    expect(prodA?.stock).toBe(0);
    expect(prodB?.stock).toBe(0);

    // Exactly 1 new order should be persisted
    const finalOrdersCount = await prisma.order.count({
      where: { customer_id: { in: [userA.id, userB.id] } },
    });
    expect(finalOrdersCount - initialOrdersCount).toBe(1);
  });
});
