import { Router, Request, Response } from "express";
import bcrypt from "bcryptjs";
import { prisma } from "../prisma.js";
import { authenticateToken, generateToken } from "../middleware/auth.js";

export const authRouter = Router();

// POST /api/auth/register (AC-01, FR-01)
authRouter.post("/register", async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, password } = req.body;

    if (!email || typeof email !== "string" || !email.includes("@")) {
      res.status(400).json({
        success: false,
        error: { code: "VALIDATION_ERROR", message: "Valid email is required." },
      });
      return;
    }

    if (!password || typeof password !== "string" || password.length < 6) {
      res.status(400).json({
        success: false,
        error: {
          code: "VALIDATION_ERROR",
          message: "Password must be at least 6 characters long.",
        },
      });
      return;
    }

    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      res.status(400).json({
        success: false,
        error: { code: "USER_EXISTS", message: "Email is already registered." },
      });
      return;
    }

    const saltRounds = 10;
    const password_hash = await bcrypt.hash(password, saltRounds);

    const newUser = await prisma.user.create({
      data: {
        email,
        password_hash,
        role: "CUSTOMER", // default role is always Customer
      },
      select: {
        id: true,
        email: true,
        role: true,
        created_at: true,
      },
    });

    const token = generateToken({
      id: newUser.id,
      email: newUser.email,
      role: newUser.role,
    });

    res.status(201).json({
      success: true,
      data: {
        token,
        user: newUser,
      },
    });
  } catch (error) {
    console.error("Register error:", error);
    res.status(500).json({
      success: false,
      error: { code: "SERVER_ERROR", message: "Internal server error." },
    });
  }
});

// POST /api/auth/login (AC-02, BR-01)
authRouter.post("/login", async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      res.status(400).json({
        success: false,
        error: { code: "VALIDATION_ERROR", message: "Email and password are required." },
      });
      return;
    }

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      res.status(401).json({
        success: false,
        error: { code: "INVALID_CREDENTIALS", message: "Invalid email or password." },
      });
      return;
    }

    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) {
      res.status(401).json({
        success: false,
        error: { code: "INVALID_CREDENTIALS", message: "Invalid email or password." },
      });
      return;
    }

    const token = generateToken({
      id: user.id,
      email: user.email,
      role: user.role,
    });

    res.status(200).json({
      success: true,
      data: {
        token,
        user: {
          id: user.id,
          email: user.email,
          role: user.role,
        },
      },
    });
  } catch (error) {
    console.error("Login error:", error);
    res.status(500).json({
      success: false,
      error: { code: "SERVER_ERROR", message: "Internal server error." },
    });
  }
});

// GET /api/auth/me (AC-03, FR-02)
authRouter.get("/me", authenticateToken, async (req: Request, res: Response): Promise<void> => {
  res.status(200).json({
    success: true,
    data: {
      user: req.user,
    },
  });
});

// POST /api/auth/logout
authRouter.post("/logout", (_req: Request, res: Response): void => {
  res.status(200).json({
    success: true,
    data: { message: "Successfully logged out." },
  });
});
