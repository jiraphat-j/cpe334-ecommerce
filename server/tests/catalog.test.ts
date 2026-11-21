import { beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { app } from "../src/app.js";
import { generateToken } from "../src/middleware/auth.js";
import { prisma } from "../src/prisma.js";

vi.mock("../src/prisma.js", () => ({
  prisma: {
    $transaction: vi.fn(),
    product: { findMany: vi.fn(), findUnique: vi.fn(), create: vi.fn(), updateMany: vi.fn() },
    order: { findUnique: vi.fn(), create: vi.fn() },
  },
}));

const path = "/api/operator/products";
const operator = `Bearer ${generateToken({ id: "op", email: "op@example.com", role: "OPERATOR" })}`;
const customer = `Bearer ${generateToken({ id: "cust", email: "cust@example.com", role: "CUSTOMER" })}`;
const product = { id: "p1", name: "Mouse", description: null, price: 99.5, stock: 3, archived_at: null };

describe("F-05 operator catalog", () => {
  beforeEach(() => vi.resetAllMocks());

  it("TEST-F05-01: creates, edits, and retrieves an Operator product", async () => {
    vi.mocked(prisma.product.create).mockResolvedValue(product as never);
    vi.mocked(prisma.product.updateMany).mockResolvedValue({ count: 1 });
    const updated = { ...product, price: 120.19 };
    vi.mocked(prisma.product.findUnique).mockResolvedValue(updated as never);
    vi.mocked(prisma.product.findMany).mockResolvedValue([updated] as never);

    const created = await request(app).post(path).set("Authorization", operator)
      .send({ name: " Mouse ", price: 99.5, stock: 3 });
    expect(created.status).toBe(201);
    expect(prisma.product.create).toHaveBeenCalledWith({
      data: { name: "Mouse", price: 99.5, stock: 3 },
    });

    const edited = await request(app).patch(`${path}/p1`).set("Authorization", operator)
      .send({ price: 120.19 });
    expect(edited.status).toBe(200);
    expect(edited.body.data.product.price).toBe(120.19);
    const listed = await request(app).get(path).set("Authorization", operator);
    expect(listed.body.data.products).toEqual([updated]);
  });

  it("TEST-F05-02: sets stock to zero and rejects a stale stock edit", async () => {
    vi.mocked(prisma.product.updateMany).mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });
    vi.mocked(prisma.product.findUnique).mockResolvedValue({ ...product, stock: 0 } as never);
    const adjust = () => request(app).patch(`${path}/p1/stock`).set("Authorization", operator)
      .send({ stock: 0, expectedStock: 3 });
    const saved = await adjust();
    expect(saved.status).toBe(200);
    expect(saved.body.data.product.stock).toBe(0);
    expect(prisma.product.updateMany).toHaveBeenCalledWith({
      where: { id: "p1", archived_at: null, stock: 3 }, data: { stock: 0 },
    });
    const conflict = await adjust();
    expect(conflict.status).toBe(409);
    expect(conflict.body.error.code).toBe("STOCK_CHANGED");
  });

  it.each([
    { price: 0 }, { price: 1.001 }, { price: "19.99" }, { name: " " },
    { stock: -1 }, { stock: 0.5 }, { stock: 2_147_483_648 },
  ])("TEST-F05-02: rejects invalid fields %j before writing", async (fields) => {
    const result = await request(app).post(path).set("Authorization", operator)
      .send({ name: "Mouse", price: 19.99, stock: 1, ...fields });
    expect(result.status).toBe(400);
    expect(prisma.product.create).not.toHaveBeenCalled();
  });

  it("TEST-F05-03: archive is repeatable and the catalog filters archived products", async () => {
    const archived = { ...product, archived_at: new Date("2026-11-21T00:00:00Z") };
    vi.mocked(prisma.product.updateMany).mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });
    vi.mocked(prisma.product.findUnique).mockResolvedValue(archived as never);
    vi.mocked(prisma.product.findMany).mockResolvedValue([]);

    for (let i = 0; i < 2; i += 1) {
      const response = await request(app).post(`${path}/p1/archive`).set("Authorization", operator);
      expect(response.status).toBe(200);
      expect(response.body.data.product.archived_at).toBe(archived.archived_at.toISOString());
    }
    const listed = await request(app).get("/api/products");
    expect(listed.status).toBe(200);
    expect(prisma.product.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { archived_at: null } }));
  });

  it("TEST-F05-03: when archive wins the inventory write, checkout creates no order", async () => {
    vi.mocked(prisma.product.findUnique).mockResolvedValue({ ...product, archived_at: new Date() } as never);
    vi.mocked(prisma.product.updateMany).mockResolvedValue({ count: 0 });
    vi.mocked(prisma.$transaction).mockImplementation(async (callback) => (
      (callback as (tx: typeof prisma) => Promise<unknown>)(prisma)
    ));
    const rejected = await request(app).post("/api/orders").set("Authorization", customer)
      .send({ productId: "p1", quantity: 1 });
    expect(rejected.status).toBe(409);
    expect(rejected.body.error.code).toBe("PRODUCT_ARCHIVED");
    expect(prisma.product.updateMany).toHaveBeenCalledWith({
      where: { id: "p1", archived_at: null, stock: { gte: 1 } },
      data: { stock: { decrement: 1 } },
    });
    expect(prisma.order.create).not.toHaveBeenCalled();
  });

  it.each([
    ["get", path], ["post", path], ["patch", `${path}/p1`],
    ["patch", `${path}/p1/stock`], ["post", `${path}/p1/archive`],
  ] as const)("TEST-F05-04: protects %s %s before storage access", async (method, endpoint) => {
    expect((await request(app)[method](endpoint)).status).toBe(401);
    expect((await request(app)[method](endpoint).set("Authorization", customer)).status).toBe(403);
    for (const operation of Object.values(prisma.product)) {
      expect(operation).not.toHaveBeenCalled();
    }
  });
});
