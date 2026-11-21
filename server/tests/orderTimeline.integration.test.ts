import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { OrderStatus, Role } from "@prisma/client";
import { app } from "../src/app.js";
import { generateToken } from "../src/middleware/auth.js";
import { prisma } from "../src/prisma.js";

describe("F-08 order timeline on PostgreSQL", () => {
  const fixture = randomUUID();
  const owner = { id: `f08-${fixture}-owner`, email: `${fixture}-owner@example.test`, role: Role.CUSTOMER };
  const other = { id: `f08-${fixture}-other`, email: `${fixture}-other@example.test`, role: Role.CUSTOMER };
  const operator = { id: `f08-${fixture}-op`, email: `${fixture}-op@example.test`, role: Role.OPERATOR };
  const users = [owner, other, operator];
  const auth = (user: typeof users[number]) => `Bearer ${generateToken(user)}`;

  beforeAll(async () => {
    await prisma.user.createMany({ data: users.map((user) => ({ ...user, password_hash: "test-fixture" })) });
  });

  afterAll(async () => {
    try {
      await prisma.user.deleteMany({ where: { id: { in: users.map(({ id }) => id) } } });
    } finally {
      await prisma.$disconnect();
    }
  });

  const createOrder = (status: OrderStatus = OrderStatus.PENDING) =>
    prisma.order.create({ data: { customer_id: owner.id, total_amount: 100, status } });

  const confirm = (id: string, actor = operator) =>
    request(app).patch(`/api/operator/orders/${id}/status`)
      .set("Authorization", auth(actor)).send({ status: OrderStatus.CONFIRMED });

  const details = (id: string, user = owner) =>
    request(app).get(`/api/orders/${id}`).set("Authorization", auth(user));

  it("TEST-F08-01/03: persists a confirmation event, exposes its time and states to the owner, and keeps actor data private", async () => {
    const order = await createOrder();
    expect((await confirm(order.id)).status).toBe(200);

    const response = await details(order.id);
    expect(response.status).toBe(200);
    const saved = response.body.data.order;
    expect(saved.status).toBe("CONFIRMED");
    expect(saved.timeline).toEqual([
      { from_status: "PENDING", to_status: "CONFIRMED", created_at: expect.any(String) },
    ]);
    const events = await prisma.$queryRaw<{ actor_id: string; created_at: Date }[]>`
      SELECT actor_id, created_at FROM order_status_events WHERE order_id = ${order.id}
    `;
    expect(events).toEqual([{ actor_id: operator.id, created_at: expect.any(Date) }]);
    expect(saved.timeline[0].created_at).toBe(events[0].created_at.toISOString());
  });

  it("TEST-F08-02: concurrent confirmations and repeated confirmation create only one event", async () => {
    const order = await createOrder();
    const results = await Promise.all([confirm(order.id), confirm(order.id)]);
    expect(results.map(({ status }) => status)).toContain(200);
    expect(results.every(({ status }) => status === 200 || status === 409)).toBe(true);
    expect((await confirm(order.id)).status).toBe(200);
    expect((await details(order.id)).body.data.order.timeline).toHaveLength(1);
  });

  it("TEST-F08-02: rejecting confirmation of a cancelled order leaves its timeline empty", async () => {
    const order = await createOrder(OrderStatus.CANCELLED);
    expect((await confirm(order.id)).status).toBe(400);
    expect((await details(order.id)).body.data.order).toMatchObject({ status: "CANCELLED", timeline: [] });
  });

  it("TEST-F08-02: an actor FK failure rolls back the status update as well as the event", async () => {
    const order = await createOrder();
    const removedOperator = { ...operator, id: `removed-${fixture}` };
    expect((await confirm(order.id, removedOperator)).status).toBe(500);
    expect((await details(order.id)).body.data.order).toMatchObject({ status: "PENDING", timeline: [] });
  });

  it("TEST-F08-03: another Customer and an unauthenticated visitor cannot read the event", async () => {
    const order = await createOrder();
    expect((await confirm(order.id)).status).toBe(200);
    expect((await details(order.id)).body.data.order.timeline).toHaveLength(1);
    const forbidden = await details(order.id, other);
    expect(forbidden.status).toBe(403);
    expect(forbidden.body.data).toBeUndefined();
    expect((await request(app).get(`/api/orders/${order.id}`)).status).toBe(401);
  });

  it("TEST-F08-04: a legacy confirmed order without recorded history still opens", async () => {
    const order = await createOrder(OrderStatus.CONFIRMED);
    const response = await details(order.id);
    expect(response.status).toBe(200);
    expect(response.body.data.order).toMatchObject({ id: order.id, status: "CONFIRMED", timeline: [] });
  });
});
