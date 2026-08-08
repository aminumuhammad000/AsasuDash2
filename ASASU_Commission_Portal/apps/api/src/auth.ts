import type { NextFunction, Request, Response } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import type { Role } from "@asasu/shared";
import { publicUser } from "./domain.js";
import type { JsonStore } from "./store.js";
import type { StoredUser } from "./domain.js";

const jwtSecret = process.env.JWT_SECRET || "asasudash_secret_2026";

declare global {
  namespace Express {
    interface Request {
      user?: StoredUser;
    }
  }
}

export async function verifyPassword(password: string, hash: string) {
  return bcrypt.compare(password, hash);
}

export async function hashPassword(password: string) {
  return bcrypt.hash(password, 12);
}

export function signToken(user: StoredUser) {
  return jwt.sign({ sub: user.id, id: user.id, role: user.role, email: user.email, name: user.name }, jwtSecret, { expiresIn: "7d" });
}

export function authMiddleware(store: JsonStore) {
  return async (request: Request, response: Response, next: NextFunction) => {
    const header = request.headers.authorization;
    const token = header?.startsWith("Bearer ") ? header.slice(7) : undefined;

    if (!token) {
      response.status(401).json({ message: "Missing bearer token" });
      return;
    }

    try {
      const payload = jwt.verify(token, jwtSecret) as { sub?: string; id?: string; email?: string; role?: Role | string; name?: string };
      const userId = payload.sub || payload.id || "";
      const userEmail = payload.email || "";
      const data = await store.read();

      let user = data.users.find(
        (item) => (item.id === userId || (userEmail && item.email.toLowerCase() === userEmail.toLowerCase())) && item.active
      );

      if (!user && (userEmail || userId)) {
        const rawRole = payload.role ? String(payload.role).toUpperCase() : "ADMIN";
        const normRole: Role = (rawRole === "SUPER_ADMIN" || rawRole === "ADMIN" || rawRole === "FINANCE" || rawRole === "OPERATIONS" || rawRole === "BRANCH_ADMIN" || rawRole === "SUPPORT" || rawRole === "AUDITOR" || rawRole === "SUB_DEVELOPER") ? (rawRole as Role) : "AGENT";
        user = {
          id: userId || `usr_${Date.now()}`,
          name: payload.name || "Authenticated User",
          email: (userEmail || `user_${userId}@asasurealty.com`).toLowerCase(),
          role: normRole,
          agency: "ASASU Realty",
          active: true,
          createdAt: new Date().toISOString(),
          passwordHash: ""
        };
        data.users.push(user);
        await store.write(data);
      }

      if (!user || !user.active) {
        response.status(401).json({ message: "User is inactive or does not exist" });
        return;
      }
      request.user = user;
      next();
    } catch (err) {
      console.warn("JWT verification failed in authMiddleware:", err);
      response.status(401).json({ message: "Invalid or expired token" });
    }
  };
}

export function requireRole(...roles: Role[]) {
  return (request: Request, response: Response, next: NextFunction) => {
    if (!request.user || !roles.includes(request.user.role)) {
      response.status(403).json({ message: "You do not have access to this action" });
      return;
    }
    next();
  };
}

export function authResponse(user: StoredUser) {
  return { ...publicUser(user), token: signToken(user) };
}
