import { Router, Request, Response } from "express";
import { prisma } from "../prisma.js";
import { authenticateToken, requireRole } from "../middleware/auth.js";
import { OrderStatus, Prisma } from "@prisma/client";

export const ordersRouter = Router();

// Enforce authentication on all /api/orders routes
ordersRouter.use(authenticateToken);

class StockLimitError extends Error {}

// POST /api/orders/:id/cancel - Customer cancellation and stock restoration (F-07)
ordersRouter.post("/:id/cancel", requireRole("CUSTOMER"), async (req, res): Promise<void> => {
  const { id } = req.params;
  const customerId = req.user!.id;

  try {
    const existing = await prisma.order.findUnique({
      where: { id },
      select: { customer_id: true },
    });

    if (!existing) {
      res.status(404).json({ success: false, error: { code: "ORDER_NOT_FOUND", message: "Order not found." } });
      return;
    }
    if (existing.customer_id !== customerId) {
      res.status(403).json({
        success: false,
        error: { code: "FORBIDDEN", message: "You can only cancel your own orders." },
      });
      return;
    }

    const order = await prisma.$transaction(async (tx) => {
      const cancelled = await tx.order.update({
        where: { id, customer_id: customerId, status: OrderStatus.PENDING },
        data: { status: OrderStatus.CANCELLED },
        include: { items: true },
      });

      // Match checkout's product lock order. Archived products still hold inventory.
      const items = [...cancelled.items].sort((a, b) => a.product_id.localeCompare(b.product_id));
      for (const { product_id, quantity } of items) {
        const restored = await tx.product.updateMany({
          where: { id: product_id, stock: { lte: 2_147_483_647 - quantity } },
          data: { stock: { increment: quantity } },
        });
        if (restored.count !== 1) {
          throw new StockLimitError("Restoring this order would exceed the stock limit.");
        }
      }
      return cancelled;
    });

    res.json({ success: true, data: { order } });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
      res.status(409).json({
        success: false,
        error: { code: "INVALID_TRANSITION", message: "Only pending orders can be cancelled." },
      });
      return;
    }
    if (error instanceof StockLimitError) {
      res.status(409).json({ success: false, error: { code: "STOCK_LIMIT", message: error.message } });
      return;
    }
    console.error("Customer cancellation failed:", error);
    res.status(500).json({ success: false, error: { code: "SERVER_ERROR", message: "Failed to cancel order." } });
  }
});

// POST /api/orders - Customer Order Placement (F-03, F-06, AC-F06-01 to AC-F06-05)
ordersRouter.post("/", async (req: Request, res: Response): Promise<void> => {
  try {
    const customerId = req.user?.id;
    if (!customerId) {
      res.status(401).json({
        success: false,
        error: { code: "UNAUTHORIZED", message: "Authentication required." },
      });
      return;
    }

    // Role check: Only CUSTOMER role can place orders
    if (req.user?.role !== "CUSTOMER") {
      res.status(403).json({
        success: false,
        error: { code: "FORBIDDEN", message: "Only customers can place orders." },
      });
      return;
    }

    // Support both multi-item array payload ({ items: [...] }) and legacy single-item payload ({ productId, quantity })
    let rawItems: any[] = [];
    if (Array.isArray(req.body?.items)) {
      rawItems = req.body.items;
    } else if (req.body?.productId !== undefined) {
      rawItems = [{ productId: req.body.productId, quantity: req.body.quantity }];
    } else {
      res.status(400).json({
        success: false,
        error: { code: "INVALID_ORDER", message: "Cart items are required." },
      });
      return;
    }

    if (!rawItems.length) {
      res.status(400).json({
        success: false,
        error: { code: "INVALID_ORDER", message: "Cart cannot be empty." },
      });
      return;
    }

    // Aggregate quantities for duplicate product IDs and validate each line
    const itemMap = new Map<string, number>();
    for (const item of rawItems) {
      if (!item || typeof item !== "object") {
        res.status(400).json({
          success: false,
          error: { code: "INVALID_ORDER", message: "Invalid item payload." },
        });
        return;
      }

      const { productId, quantity } = item;
      if (!productId || typeof productId !== "string") {
        res.status(400).json({
          success: false,
          error: { code: "INVALID_PRODUCT", message: "Valid productId is required." },
        });
        return;
      }

      if (typeof quantity !== "number" || quantity <= 0 || !Number.isInteger(quantity) || quantity > 2_147_483_647) {
        res.status(400).json({
          success: false,
          error: { code: "INVALID_QUANTITY", message: "Quantity must be a positive integer." },
        });
        return;
      }

      const currentTotal = itemMap.get(productId) || 0;
      const combinedQty = currentTotal + quantity;
      // Guard against aggregated quantity exceeding PostgreSQL 32-bit integer range (Reviewer P2)
      if (combinedQty > 2_147_483_647 || !Number.isSafeInteger(combinedQty)) {
        res.status(400).json({
          success: false,
          error: { code: "INVALID_QUANTITY", message: "Total combined quantity per product exceeds supported integer limit." },
        });
        return;
      }

      itemMap.set(productId, combinedQty);
    }

    // Sort items deterministically by productId to prevent deadlocks (40P01) during concurrent checkouts (Reviewer P1)
    const normalizedItems = Array.from(itemMap.entries())
      .map(([productId, quantity]) => ({
        productId,
        quantity,
      }))
      .sort((a, b) => a.productId.localeCompare(b.productId));

    // Execute atomic transaction for stock verification, deduction, and order creation
    const result = await prisma.$transaction(async (tx) => {
      let totalAmount = 0;
      const orderItemsData: { product_id: string; quantity: number; unit_price: number }[] = [];

      for (const { productId, quantity } of normalizedItems) {
        // Guarded write to atomically decrement stock only if active and sufficient stock exists
        const inventory = await tx.product.updateMany({
          where: { id: productId, archived_at: null, stock: { gte: quantity } },
          data: { stock: { decrement: quantity } },
        });

        const product = await tx.product.findUnique({
          where: { id: productId },
        });

        if (!product) {
          throw { status: 404, code: "PRODUCT_NOT_FOUND", message: "Product not found." };
        }

        if (inventory.count === 0 && product.archived_at) {
          throw { status: 409, code: "PRODUCT_ARCHIVED", message: `Product '${product.name}' is archived and no longer available.` };
        }

        if (inventory.count === 0) {
          throw {
            status: 400,
            code: "INSUFFICIENT_STOCK",
            message: `Insufficient stock for '${product.name}'. Requested ${quantity}, available ${product.stock}.`,
          };
        }

        totalAmount += product.price * quantity;
        orderItemsData.push({
          product_id: productId,
          quantity,
          unit_price: product.price,
        });
      }

      // Create Order record with PENDING status and associated OrderItems
      const order = await tx.order.create({
        data: {
          customer_id: customerId,
          status: OrderStatus.PENDING,
          total_amount: totalAmount,
          items: {
            create: orderItemsData,
          },
        },
        include: {
          items: {
            include: { product: true },
          },
        },
      });

      return order;
    });

    res.status(201).json({
      success: true,
      data: { order: result },
    });
  } catch (error: any) {
    if (error && error.status && error.code) {
      res.status(error.status).json({
        success: false,
        error: { code: error.code, message: error.message },
      });
      return;
    }

    console.error("Order creation transaction error:", error);
    res.status(500).json({
      success: false,
      error: { code: "SERVER_ERROR", message: "Failed to process order." },
    });
  }
});

// GET /api/orders/my-orders - Authenticated Customer order history (AC-07, TEST-09)
ordersRouter.get("/my-orders", async (req: Request, res: Response): Promise<void> => {
  try {
    const customerId = req.user?.id;
    if (!customerId) {
      res.status(401).json({
        success: false,
        error: { code: "UNAUTHORIZED", message: "Authentication required." },
      });
      return;
    }

    const orders = await prisma.order.findMany({
      where: { customer_id: customerId },
      include: {
        items: {
          include: { product: true },
        },
      },
      orderBy: { created_at: "desc" },
    });

    res.status(200).json({
      success: true,
      data: { orders },
    });
  } catch (error) {
    console.error("Fetch my orders error:", error);
    res.status(500).json({
      success: false,
      error: { code: "SERVER_ERROR", message: "Failed to fetch order history." },
    });
  }
});

// GET /api/orders/:id - Retrieve order details with Owner Isolation (AC-07, TEST-08)
ordersRouter.get("/:id", async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const user = req.user;

    if (!user) {
      res.status(401).json({
        success: false,
        error: { code: "UNAUTHORIZED", message: "Authentication required." },
      });
      return;
    }

    const order = await prisma.order.findUnique({
      where: { id },
      include: {
        items: {
          include: { product: true },
        },
      },
    });

    if (!order) {
      res.status(404).json({
        success: false,
        error: { code: "ORDER_NOT_FOUND", message: "Order not found." },
      });
      return;
    }

    // Customer Isolation Check: A customer can only access their own order
    if (user.role !== "OPERATOR" && order.customer_id !== user.id) {
      res.status(403).json({
        success: false,
        error: {
          code: "FORBIDDEN",
          message: "Access denied. You can only inspect orders belonging to your account.",
        },
      });
      return;
    }

    res.status(200).json({
      success: true,
      data: { order },
    });
  } catch (error) {
    console.error("Fetch single order error:", error);
    res.status(500).json({
      success: false,
      error: { code: "SERVER_ERROR", message: "Failed to fetch order." },
    });
  }
});
