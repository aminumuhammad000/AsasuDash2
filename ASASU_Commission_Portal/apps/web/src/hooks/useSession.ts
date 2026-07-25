import { create } from "zustand";
import type { AuthUser } from "@asasu/shared";
import { login as apiLogin } from "../lib/api";

const storageKey = "asasu-session";

interface SessionState {
  user?: AuthUser;
  token?: string;
  hydrated: boolean;
  expiredNotification?: string;
  restore: () => void;
  login: (email: string, password: string) => Promise<void>;
  logout: (expiredReason?: string) => void;
  clearExpiredNotification: () => void;
}

export const useSession = create<SessionState>((set) => ({
  hydrated: false,
  expiredNotification: undefined,
  restore: () => {
    const raw = localStorage.getItem(storageKey);
    if (!raw) {
      set({ hydrated: true });
      return;
    }
    const user = JSON.parse(raw) as AuthUser;
    set({ user, token: user.token, hydrated: true });
  },
  login: async (email, password) => {
    const user = await apiLogin(email, password);
    localStorage.setItem(storageKey, JSON.stringify(user));
    set({ user, token: user.token, hydrated: true, expiredNotification: undefined });
  },
  logout: (expiredReason?: string) => {
    localStorage.removeItem(storageKey);
    set({ user: undefined, token: undefined, hydrated: true, expiredNotification: expiredReason });
  },
  clearExpiredNotification: () => {
    set({ expiredNotification: undefined });
  }
}));
