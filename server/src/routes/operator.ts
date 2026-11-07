import { Router, Request, Response } from "express";
import { prisma } from "../prisma.js";
import { authenticateToken, requireRole } from "../middleware/auth.js";
import { OrderStatus } from "@prisma/client";

export const operatorRouter = Router();

// Enforce both authentication and OPERATOR role on all /api/operator routes
operatorRouter.use(authenticateToken);
operatorRouter.use(requireRole("OPERATOR"));

// GET /api/operator/orders (AC-08, TEST-10, TEST-13)
operatorRouter.get("/orders", async (_req: Request, res: Response): Promise<void> => {
  try {
    const orders = await prisma.order.findMany({
      include: {
        customer: {
          select: { id: true, email: true, role: true },
        },
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
    console.error("Operator orders fetch error:", error);
    res.status(500).json({
      success: false,
      error: { code: "SERVER_ERROR", message: "Failed to fetch orders." },
    });
  }
});

// PATCH /api/operator/orders/:id/status (AC-09, AC-10, TEST-11, TEST-12)
operatorRouter.patch("/orders/:id/status", async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    const validStatuses: OrderStatus[] = [
      OrderStatus.PENDING,
      OrderStatus.CONFIRMED,
      OrderStatus.SHIPPED,
      OrderStatus.CANCELLED,
    ];

    if (!status || !validStatuses.includes(status as OrderStatus)) {
      res.status(400).json({
        success: false,
        error: { code: "INVALID_STATUS", message: `Status must be one of: ${validStatuses.join(", ")}` },
      });
      return;
    }

    const order = await prisma.order.findUnique({ where: { id } });
    if (!order) {
      res.status(404).json({
        success: false,
        error: { code: "ORDER_NOT_FOUND", message: "Order not found." },
      });
      return;
    }

    // Business Rule 05: An order in CANCELLED status cannot transition to CONFIRMED or SHIPPED
    if (order.status === OrderStatus.CANCELLED) {
      res.status(400).json({
        success: false,
        error: {
          code: "INVALID_TRANSITION",
          message: "Cancelled orders cannot be modified or reactivated.",
        },
      });
      return;
    }

    const updatedOrder = await prisma.order.update({
      where: { id },
      data: { status: status as OrderStatus },
    });

    res.status(200).json({
      success: true,
      data: { order: updatedOrder },
    });
  } catch (error) {
    console.error("Update status error:", error);
    res.status(500).json({
      success: false,
      error: { code: "SERVER_ERROR", message: "Failed to update order status." },
    });
  }
});
