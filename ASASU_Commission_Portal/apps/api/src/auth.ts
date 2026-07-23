import type { NextFunction, Request, Response } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import type { Role } from "@asasu/shared";
import { publicUser } from "./domain.js";
import type { JsonStore } from "./store.js";
import type { StoredUser } from "./domain.js";

const jwtSecret = process.env.JWT_SECRET ?? "asasu-local-development-secret";

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

export function signToken(user: StoredUser) {
  return jwt.sign({ sub: user.id, role: user.role }, jwtSecret, { expiresIn: "12h" });
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
      const payload = jwt.verify(token, jwtSecret) as { sub: string };
      const data = await store.read();
      const user = data.users.find((item) => item.id === payload.sub && item.active);
      if (!user) {
        response.status(401).json({ message: "User is inactive or does not exist" });
        return;
      }
      request.user = user;
      next();
    } catch {
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
