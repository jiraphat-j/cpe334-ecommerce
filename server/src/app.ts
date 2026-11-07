import express from "express";
import cors from "cors";
import path from "path";
import fs from "fs";
import { prisma } from "./prisma.js";
import { authRouter } from "./routes/auth.js";
import { operatorRouter } from "./routes/operator.js";
import { productsRouter } from "./routes/products.js";
import { ordersRouter } from "./routes/orders.js";

export const app = express();

app.use(cors());
app.use(express.json());

// Cloud Health Check (Episode 2 / Smoke test requirement)
app.get("/api/health", (_req, res) => {
  res.status(200).json({ status: "ok", service: "ecommerce-api" });
});

// Database Readiness Check (Returns 503 if database is unreachable)
app.get("/api/ready", async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.status(200).json({ status: "ready", db: "connected" });
  } catch (error) {
    res.status(503).json({ status: "not_ready", error: "Database connection failed" });
  }
});

// Domain Routers
app.use("/api/auth", authRouter);
app.use("/api/operator", operatorRouter);
app.use("/api/products", productsRouter);
app.use("/api/orders", ordersRouter);

// Static Frontend Serving for Unified Production Container
const clientDistPath = path.resolve(process.cwd(), "../client/dist");
if (fs.existsSync(clientDistPath)) {
  app.use(express.static(clientDistPath));
  app.get("*", (req, res, next) => {
    if (req.path.startsWith("/api")) return next();
    res.sendFile(path.join(clientDistPath, "index.html"));
  });
}
