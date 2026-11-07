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
      $transaction: vi.fn(),
      product: {
        findMany: vi.fn(),
        findUnique: vi.fn(),
        update: vi.fn(),
      },
      order: {
        findMany: vi.fn(),
        findUnique: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
      },
      orderItem: {
        create: vi.fn(),
      },
    },
  };
});

describe("Issue #3: Product Catalog & Customer Order Workflow (F-02, F-03)", () => {
  const customerToken = generateToken({
    id: "cust-1",
    email: "customer@example.com",
    role: "CUSTOMER",
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // TEST-04: Product Catalog Retrieval (AC-04, FR-03)
  it("TEST-04: GET /api/products should return list of products with current stock", async () => {
    const mockProducts = [
      { id: "prod-1", name: "Mechanical Keyboard", price: 1500, stock: 10, description: "RGB Keyboard" },
      { id: "prod-2", name: "Wireless Mouse", price: 800, stock: 5, description: "Ergonomic Mouse" },
    ];
    (prisma.product.findMany as any).mockResolvedValue(mockProducts);

    const res = await request(app).get("/api/products");

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.products).toHaveLength(2);
    expect(res.body.data.products[0]).toMatchObject({
      id: "prod-1",
      name: "Mechanical Keyboard",
      price: 1500,
      stock: 10,
    });
  });

  // TEST-05: Successful Order Placement & Atomic Deduction (AC-05, BR-04, FR-04)
  it("TEST-05: POST /api/orders should atomically deduct stock and create order with status PENDING", async () => {
    const mockProduct = {
      id: "prod-1",
      name: "Mechanical Keyboard",
      price: 1500,
      stock: 10,
    };
    (prisma.product.findUnique as any).mockResolvedValue(mockProduct);

    const mockOrder = {
      id: "order-1",
      customer_id: "cust-1",
      status: OrderStatus.PENDING,
      total_amount: 3000,
      created_at: new Date(),
      items: [
        { id: "item-1", product_id: "prod-1", quantity: 2, unit_price: 1500 },
      ],
    };

    (prisma.$transaction as any).mockImplementation(async (callback: any) => {
      return callback({
        product: {
          findUnique: vi.fn().mockResolvedValue(mockProduct),
          update: vi.fn().mockResolvedValue({ ...mockProduct, stock: 8 }),
        },
        order: {
          create: vi.fn().mockResolvedValue(mockOrder),
        },
      });
    });

    const res = await request(app)
      .post("/api/orders")
      .set("Authorization", `Bearer ${customerToken}`)
      .send({ productId: "prod-1", quantity: 2 });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.order.status).toBe(OrderStatus.PENDING);
    expect(res.body.data.order.total_amount).toBe(3000);
  });

  // TEST-06: Out-of-Stock Boundary Rejection (AC-06, BR-03)
  it("TEST-06: POST /api/orders should reject with 400 Bad Request when quantity > stock", async () => {
    const mockProduct = {
      id: "prod-1",
      name: "Mechanical Keyboard",
      price: 1500,
      stock: 2,
    };
    (prisma.product.findUnique as any).mockResolvedValue(mockProduct);

    (prisma.$transaction as any).mockImplementation(async (callback: any) => {
      return callback({
        product: {
          findUnique: vi.fn().mockResolvedValue(mockProduct),
        },
      });
    });

    const res = await request(app)
      .post("/api/orders")
      .set("Authorization", `Bearer ${customerToken}`)
      .send({ productId: "prod-1", quantity: 5 });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe("INSUFFICIENT_STOCK");
  });

  // TEST-07: Invalid Quantity Rejection (AC-06, BR-03)
  it("TEST-07: POST /api/orders should reject with 400 when quantity <= 0 or invalid", async () => {
    const resZero = await request(app)
      .post("/api/orders")
      .set("Authorization", `Bearer ${customerToken}`)
      .send({ productId: "prod-1", quantity: 0 });

    expect(resZero.status).toBe(400);
    expect(resZero.body.error.code).toBe("INVALID_QUANTITY");

    const resNegative = await request(app)
      .post("/api/orders")
      .set("Authorization", `Bearer ${customerToken}`)
      .send({ productId: "prod-1", quantity: -3 });

    expect(resNegative.status).toBe(400);
    expect(resNegative.body.error.code).toBe("INVALID_QUANTITY");
  });

  // TEST-08: Customer Order Isolation (AC-07, BR-02)
  it("TEST-08: GET /api/orders/:id should return 403 when Customer A accesses Customer B's order", async () => {
    (prisma.order.findUnique as any).mockResolvedValue({
      id: "order-cust-2",
      customer_id: "cust-2",
      status: OrderStatus.PENDING,
      total_amount: 1500,
    });

    const res = await request(app)
      .get("/api/orders/order-cust-2")
      .set("Authorization", `Bearer ${customerToken}`);

    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe("FORBIDDEN");
  });

  // TEST-09: Customer Order History (AC-07, FR-05)
  it("TEST-09: GET /api/orders/my-orders should return only the authenticated Customer's orders", async () => {
    const mockOrders = [
      { id: "order-1", customer_id: "cust-1", total_amount: 1500, status: OrderStatus.PENDING },
      { id: "order-2", customer_id: "cust-1", total_amount: 800, status: OrderStatus.CONFIRMED },
    ];
    (prisma.order.findMany as any).mockResolvedValue(mockOrders);

    const res = await request(app)
      .get("/api/orders/my-orders")
      .set("Authorization", `Bearer ${customerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.orders).toHaveLength(2);
    expect(prisma.order.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { customer_id: "cust-1" },
      })
    );
  });
});
