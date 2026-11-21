import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "../src/app.js";
import { generateToken } from "../src/middleware/auth.js";
import { prisma } from "../src/prisma.js";

describe("F-07 cancellation on PostgreSQL", () => {
  const fixture = randomUUID();
  const owner = { id: `f07-${fixture}-owner`, email: `${fixture}-owner@example.test`, role: "CUSTOMER" as const };
  const other = { id: `f07-${fixture}-other`, email: `${fixture}-other@example.test`, role: "CUSTOMER" as const };
  const operator = { id: `f07-${fixture}-operator`, email: `${fixture}-operator@example.test`, role: "OPERATOR" as const };
  const users = [owner, other, operator];
  const a = `f07-${fixture}-a`;
  const b = `f07-${fixture}-b`;
  const auth = (user: typeof users[number]) => `Bearer ${generateToken(user)}`;

  beforeAll(async () => {
    await prisma.user.createMany({ data: users.map((user) => ({ ...user, password_hash: "test-fixture" })) });
    await prisma.product.createMany({ data: [
      { id: a, name: "F-07 item A", price: 10, stock: 10 },
      { id: b, name: "F-07 item B", price: 20, stock: 10 },
    ] });
  });

  beforeEach(async () => {
    await prisma.product.updateMany({ where: { id: { in: [a, b] } }, data: { stock: 10, archived_at: null } });
  });

  afterAll(async () => {
    try {
      await prisma.user.deleteMany({ where: { id: { in: users.map(({ id }) => id) } } });
      await prisma.product.deleteMany({ where: { id: { in: [a, b] } } });
    } finally {
      await prisma.$disconnect();
    }
  });

  async function order(multiItem = true): Promise<string> {
    const payload = multiItem
      ? { items: [{ productId: a, quantity: 2 }, { productId: b, quantity: 3 }] }
      : { productId: a, quantity: 2 };
    const response = await request(app).post("/api/orders").set("Authorization", auth(owner)).send(payload);
    expect(response.status).toBe(201);
    return response.body.data.order.id;
  }

  const cancel = (id: string, user: typeof users[number] = owner) =>
    request(app).post(`/api/orders/${id}/cancel`).set("Authorization", auth(user));
  const confirm = (id: string) => request(app).patch(`/api/operator/orders/${id}/status`)
    .set("Authorization", auth(operator)).send({ status: "CONFIRMED" });
  const currentStatus = async (id: string) => (await prisma.order.findUniqueOrThrow({ where: { id } })).status;
  const stocks = async () => (await prisma.product.findMany({
    where: { id: { in: [a, b] } }, orderBy: { id: "asc" },
  })).map(({ stock }) => stock);

  it("TEST-F07-01/05: cancels a multi-item order, restores stock including archived products, and preserves prices", async () => {
    const id = await order();
    expect(await stocks()).toEqual([8, 7]);
    await prisma.product.update({ where: { id: b }, data: { archived_at: new Date(), price: 35 } });

    const response = await cancel(id);
    expect(response.status).toBe(200);
    expect(response.body.data.order.status).toBe("CANCELLED");
    expect(await stocks()).toEqual([10, 10]);
    expect((await prisma.product.findUniqueOrThrow({ where: { id: b } })).archived_at).not.toBeNull();

    const history = await request(app).get("/api/orders/my-orders").set("Authorization", auth(owner));
    const saved = history.body.data.orders.find((entry: { id: string }) => entry.id === id);
    expect(saved).toMatchObject({ status: "CANCELLED", total_amount: 80 });
    expect(saved.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ product_id: a, unit_price: 10, quantity: 2 }),
      expect.objectContaining({ product_id: b, unit_price: 20, quantity: 3 }),
    ]));
  });

  it("TEST-F07-02: rejects missing authentication, other owners and Operators without writes", async () => {
    const id = await order();
    expect((await request(app).post(`/api/orders/${id}/cancel`)).status).toBe(401);
    expect((await cancel(id, other)).status).toBe(403);
    expect((await cancel(id, operator)).status).toBe(403);
    expect((await cancel(`missing-${fixture}`)).status).toBe(404);
    expect(await currentStatus(id)).toBe("PENDING");
    expect(await stocks()).toEqual([8, 7]);
  });

  it("TEST-F07-03: concurrent and subsequent retries restore stock only once", async () => {
    const id = await order();
    const results = await Promise.all([cancel(id), cancel(id)]);
    expect(results.map((res) => res.status).sort()).toEqual([200, 409]);
    expect((await cancel(id)).status).toBe(409);
    expect(await currentStatus(id)).toBe("CANCELLED");
    expect(await stocks()).toEqual([10, 10]);
  });

  it("TEST-F07-03: an inventory overflow rolls back status and earlier stock increments", async () => {
    const id = await order();
    await prisma.product.update({ where: { id: b }, data: { stock: 2_147_483_647 } });
    const response = await cancel(id);
    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe("STOCK_LIMIT");
    expect(await currentStatus(id)).toBe("PENDING");
    expect(await stocks()).toEqual([8, 2_147_483_647]);
  });

  it("TEST-F07-04: concurrent Operator confirmation and cancellation allow one transition", async () => {
    const id = await order();
    const [cancellation, confirmation] = await Promise.all([cancel(id), confirm(id)]);
    expect([cancellation, confirmation].filter(({ status }) => status === 200)).toHaveLength(1);
    if (cancellation.status === 200) {
      expect([400, 409]).toContain(confirmation.status);
      expect(await currentStatus(id)).toBe("CANCELLED");
      expect(await stocks()).toEqual([10, 10]);
    } else {
      expect(cancellation.status).toBe(409);
      expect(await currentStatus(id)).toBe("CONFIRMED");
      expect(await stocks()).toEqual([8, 7]);
    }
  });

  it("TEST-F07-05: legacy single-item orders cancel and confirmed orders reject cancellation", async () => {
    const legacy = await order(false);
    expect((await cancel(legacy)).status).toBe(200);
    expect(await stocks()).toEqual([10, 10]);
    const confirmed = await order(false);
    expect((await confirm(confirmed)).status).toBe(200);
    expect((await cancel(confirmed)).status).toBe(409);
    expect(await currentStatus(confirmed)).toBe("CONFIRMED");
    expect(await stocks()).toEqual([8, 10]);
  });
});
