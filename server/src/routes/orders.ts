import { Router, Request, Response } from "express";
import { prisma } from "../prisma.js";
import { authenticateToken } from "../middleware/auth.js";
import { OrderStatus } from "@prisma/client";

export const ordersRouter = Router();

// Enforce authentication on all /api/orders routes
ordersRouter.use(authenticateToken);

// POST /api/orders - Customer Order Placement (AC-05, AC-06, TEST-05, TEST-06, TEST-07)
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

    const { productId, quantity } = req.body;

    // Validation: quantity must be positive integer
    if (!quantity || typeof quantity !== "number" || quantity <= 0 || !Number.isInteger(quantity)) {
      res.status(400).json({
        success: false,
        error: { code: "INVALID_QUANTITY", message: "Quantity must be an integer greater than 0." },
      });
      return;
    }

    if (!productId || typeof productId !== "string") {
      res.status(400).json({
        success: false,
        error: { code: "INVALID_PRODUCT", message: "Valid productId is required." },
      });
      return;
    }

    // Execute atomic transaction for stock verification, deduction, and order creation
    const result = await prisma.$transaction(async (tx) => {
      // 1. Fetch authoritative product data from database
      const product = await tx.product.findUnique({
        where: { id: productId },
      });

      if (!product) {
        throw { status: 404, code: "PRODUCT_NOT_FOUND", message: "Product not found." };
      }

      // 2. Validate sufficient stock
      if (product.stock < quantity) {
        throw {
          status: 400,
          code: "INSUFFICIENT_STOCK",
          message: `Insufficient stock for '${product.name}'. Requested ${quantity}, available ${product.stock}.`,
        };
      }

      // 3. Atomically decrement stock
      const updatedProduct = await tx.product.update({
        where: { id: productId },
        data: { stock: { decrement: quantity } },
      });

      // Guard against race conditions resulting in negative stock
      if (updatedProduct.stock < 0) {
        throw {
          status: 400,
          code: "INSUFFICIENT_STOCK",
          message: "Stock exhausted during concurrent order placement.",
        };
      }

      // 4. Calculate total amount authoritatively on server
      const totalAmount = product.price * quantity;

      // 5. Create Order record with PENDING status
      const order = await tx.order.create({
        data: {
          customer_id: customerId,
          status: OrderStatus.PENDING,
          total_amount: totalAmount,
          items: {
            create: {
              product_id: productId,
              quantity,
              unit_price: product.price,
            },
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
