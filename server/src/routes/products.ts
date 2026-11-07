import { Router, Request, Response } from "express";
import { prisma } from "../prisma.js";

export const productsRouter = Router();

// GET /api/products (AC-04, TEST-04)
productsRouter.get("/", async (_req: Request, res: Response): Promise<void> => {
  try {
    const products = await prisma.product.findMany({
      orderBy: { created_at: "asc" },
      select: {
        id: true,
        name: true,
        description: true,
        price: true,
        stock: true,
        created_at: true,
      },
    });

    res.status(200).json({
      success: true,
      data: { products },
    });
  } catch (error) {
    console.error("Products fetch error:", error);
    res.status(500).json({
      success: false,
      error: { code: "SERVER_ERROR", message: "Failed to fetch products." },
    });
  }
});
