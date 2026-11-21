import { Router, type Request, type Response } from "express";
import type { Prisma } from "@prisma/client";
import { prisma } from "../prisma.js";

export const operatorProductsRouter = Router();

function fail(res: Response, status: number, code: string, message: string): void {
  res.status(status).json({ success: false, error: { code, message } });
}

function endpoint(handler: (req: Request, res: Response) => Promise<void>) {
  return async (req: Request, res: Response): Promise<void> => {
    try {
      await handler(req, res);
    } catch (error) {
      console.error("Operator product operation failed:", error);
      fail(res, 500, "SERVER_ERROR", "Could not complete the product operation.");
    }
  };
}

function validPrice(value: unknown): value is number {
  return typeof value === "number" && value > 0
    && /^\d+(?:\.\d{1,2})?$/.test(String(value))
    && Number.isSafeInteger(Math.round(value * 100));
}

function validStock(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 2_147_483_647;
}

function details(body: Record<string, unknown>, creating: boolean): Partial<Pick<
  Prisma.ProductCreateInput, "name" | "description" | "price"
>> | null {
  const data: Partial<Pick<Prisma.ProductCreateInput, "name" | "description" | "price">> = {};
  if (creating || "name" in body) {
    if (typeof body.name !== "string" || !body.name.trim()) return null;
    data.name = body.name.trim();
  }
  if (creating || "price" in body) {
    if (!validPrice(body.price)) return null;
    data.price = body.price;
  }
  if ("description" in body) {
    if (body.description !== null && typeof body.description !== "string") return null;
    data.description = body.description;
  }
  return Object.keys(data).length ? data : null;
}

async function updateActiveProduct(
  res: Response,
  id: string,
  data: Prisma.ProductUpdateManyMutationInput,
  expectedStock?: number,
): Promise<void> {
  const { count } = await prisma.product.updateMany({
    where: { id, archived_at: null, stock: expectedStock },
    data,
  });
  const product = await prisma.product.findUnique({ where: { id } });
  if (!product) return fail(res, 404, "PRODUCT_NOT_FOUND", "Product not found.");
  if (count === 0) {
    if (product.archived_at) return fail(res, 409, "PRODUCT_ARCHIVED", "This product is archived.");
    return fail(res, 409, "STOCK_CHANGED", "Stock has changed. Review the latest quantity and try again.");
  }
  res.json({ success: true, data: { product } });
}

operatorProductsRouter.get("/", endpoint(async (_req, res) => {
  const products = await prisma.product.findMany({ orderBy: { created_at: "asc" } });
  res.json({ success: true, data: { products } });
}));

operatorProductsRouter.post("/", endpoint(async (req, res) => {
  const body = req.body ?? {};
  const data = details(body, true);
  if (!data?.name || data.price === undefined || !validStock(body.stock)) {
    return fail(res, 400, "INVALID_PRODUCT", "Enter a name, a positive THB price with up to two decimals, and a nonnegative whole stock quantity.");
  }
  const product = await prisma.product.create({
    data: { ...data, name: data.name, price: data.price, stock: body.stock },
  });
  res.status(201).json({ success: true, data: { product } });
}));

operatorProductsRouter.patch("/:id", endpoint(async (req, res) => {
  const data = details(req.body ?? {}, false);
  if (!data) return fail(res, 400, "INVALID_PRODUCT", "Enter valid product details to edit.");
  await updateActiveProduct(res, req.params.id, data);
}));

operatorProductsRouter.patch("/:id/stock", endpoint(async (req, res) => {
  const { stock, expectedStock } = req.body ?? {};
  if (!validStock(stock) || !validStock(expectedStock)) {
    return fail(res, 400, "INVALID_STOCK", "Stock quantities must be nonnegative whole numbers within the supported range.");
  }
  await updateActiveProduct(res, req.params.id, { stock }, expectedStock);
}));

operatorProductsRouter.post("/:id/archive", endpoint(async (req, res) => {
  const id = req.params.id;
  await prisma.product.updateMany({ where: { id, archived_at: null }, data: { archived_at: new Date() } });
  const product = await prisma.product.findUnique({ where: { id } });
  if (!product) return fail(res, 404, "PRODUCT_NOT_FOUND", "Product not found.");
  res.json({ success: true, data: { product } });
}));
