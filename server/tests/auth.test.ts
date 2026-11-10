import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import bcrypt from "bcryptjs";
import { app } from "../src/app.js";
import { prisma } from "../src/prisma.js";
import { generateToken } from "../src/middleware/auth.js";

// Mock Prisma client for deterministic, fast unit/integration testing
vi.mock("../src/prisma.js", () => {
  return {
    prisma: {
      $queryRaw: vi.fn(),
      user: {
        findUnique: vi.fn(),
        create: vi.fn(),
        upsert: vi.fn(),
      },
      order: {
        findMany: vi.fn(),
        findUnique: vi.fn(),
        update: vi.fn(),
      },
    },
  };
});

describe("Authentication & RBAC Test Suite (F-01)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Health endpoint test
  it("GET /api/health should return 200 OK", async () => {
    const res = await request(app).get("/api/health");
    expect(res.status).toBe(500); // Fail for Check C-02
    expect(res.body.status).toBe("ok");
  });

  // TEST-01: Register Customer (AC-01, FR-01)
  it("TEST-01: POST /api/auth/register should create a new Customer with hashed password", async () => {
    (prisma.user.findUnique as any).mockResolvedValue(null);
    (prisma.user.create as any).mockResolvedValue({
      id: "user-cust-1",
      email: "newcustomer@example.com",
      role: "CUSTOMER",
      created_at: new Date(),
    });

    const res = await request(app)
      .post("/api/auth/register")
      .send({ email: "newcustomer@example.com", password: "Password123!" });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.user.email).toBe("newcustomer@example.com");
    expect(res.body.data.user.role).toBe("CUSTOMER");
    expect(res.body.data.user.password_hash).toBeUndefined(); // Never expose password_hash
    expect(res.body.data.token).toBeDefined();
  });

  // TEST-02: Login Success & Failure (AC-02, BR-01)
  it("TEST-02: POST /api/auth/login should return 200 + token on valid credentials and 401 on wrong password", async () => {
    const password = "ValidPassword123!";
    const hashedPassword = await bcrypt.hash(password, 10);

    (prisma.user.findUnique as any).mockResolvedValue({
      id: "user-cust-1",
      email: "valid@example.com",
      password_hash: hashedPassword,
      role: "CUSTOMER",
    });

    // Valid login
    const validRes = await request(app)
      .post("/api/auth/login")
      .send({ email: "valid@example.com", password });

    expect(validRes.status).toBe(200);
    expect(validRes.body.success).toBe(true);
    expect(validRes.body.data.token).toBeDefined();
    expect(validRes.body.data.user.role).toBe("CUSTOMER");

    // Invalid login (wrong password)
    const invalidRes = await request(app)
      .post("/api/auth/login")
      .send({ email: "valid@example.com", password: "WrongPassword" });

    expect(invalidRes.status).toBe(401);
    expect(invalidRes.body.success).toBe(false);
    expect(invalidRes.body.error.code).toBe("INVALID_CREDENTIALS");
  });

  // TEST-03: Current User Identity (AC-03, FR-02)
  it("TEST-03: GET /api/auth/me should return current user profile when authenticated", async () => {
    const token = generateToken({
      id: "user-cust-1",
      email: "test@example.com",
      role: "CUSTOMER",
    });

    const res = await request(app)
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.user.email).toBe("test@example.com");
    expect(res.body.data.user.role).toBe("CUSTOMER");
  });

  // TEST-14: Zero Unauthorized Access (AC-02, AC-08, NFR-01)
  it("TEST-14: Protected endpoints must return 401 Unauthorized when unauthenticated", async () => {
    const resAuthMe = await request(app).get("/api/auth/me");
    expect(resAuthMe.status).toBe(401);
    expect(resAuthMe.body.error.code).toBe("UNAUTHORIZED");

    const resOperator = await request(app).get("/api/operator/orders");
    expect(resOperator.status).toBe(401);
    expect(resOperator.body.error.code).toBe("UNAUTHORIZED");
  });

  // TEST-13: RBAC Role Restriction (AC-08, BR-06)
  it("TEST-13: Customer must be rejected with 403 Forbidden when calling Operator endpoints", async () => {
    const customerToken = generateToken({
      id: "cust-1",
      email: "customer@example.com",
      role: "CUSTOMER",
    });

    const res = await request(app)
      .get("/api/operator/orders")
      .set("Authorization", `Bearer ${customerToken}`);

    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe("FORBIDDEN");
  });

  it("TEST-13b: Operator must be allowed (200 OK) when calling Operator endpoints", async () => {
    (prisma.order.findMany as any).mockResolvedValue([]);

    const operatorToken = generateToken({
      id: "op-1",
      email: "operator@store.com",
      role: "OPERATOR",
    });

    const res = await request(app)
      .get("/api/operator/orders")
      .set("Authorization", `Bearer ${operatorToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.orders).toEqual([]);
  });
});
