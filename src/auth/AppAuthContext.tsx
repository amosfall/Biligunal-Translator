/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { createContext, useCallback, useContext, useMemo, useState } from "react";
import { ClerkProvider, useAuth, useClerk, useUser } from "@clerk/clerk-react";

const USERNAME_KEY = "bilingual-editorial-username";

export type AppAuthValue = {
  mode: "local" | "clerk";
  isLoaded: boolean;
  userId: string | null;
  displayName: string | null;
  login: (name?: string) => void;
  logout: () => void;
  getApiToken: () => Promise<string | null>;
};

const defaultAuth: AppAuthValue = {
  mode: "local",
  isLoaded: true,
  userId: null,
  displayName: null,
  login: () => {},
  logout: () => {},
  getApiToken: async () => null,
};

const AppAuthContext = createContext<AppAuthValue>(defaultAuth);

export function useAppAuth(): AppAuthValue {
  return useContext(AppAuthContext);
}

function LocalAuthProvider({ children }: { children: React.ReactNode }) {
  const [userId, setUserId] = useState<string | null>(() => localStorage.getItem(USERNAME_KEY));

  const login = useCallback((name?: string) => {
    const trimmed = (name ?? "").trim();
    if (!trimmed) return;
    localStorage.setItem(USERNAME_KEY, trimmed);
    setUserId(trimmed);
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem(USERNAME_KEY);
    setUserId(null);
  }, []);

  const getApiToken = useCallback(async () => null as string | null, []);

  const value = useMemo<AppAuthValue>(
    () => ({
      mode: "local",
      isLoaded: true,
      userId,
      displayName: userId,
      login,
      logout,
      getApiToken,
    }),
    [userId, login, logout, getApiToken]
  );

  return <AppAuthContext.Provider value={value}>{children}</AppAuthContext.Provider>;
}

function ClerkAuthProvider({ children }: { children: React.ReactNode }) {
  const { user, isLoaded } = useUser();
  const { signOut, openSignIn } = useClerk();
  const { getToken } = useAuth();

  const getApiToken = useCallback(() => getToken(), [getToken]);

  const login = useCallback(() => {
    openSignIn({});
  }, [openSignIn]);

  const logout = useCallback(() => {
    void signOut();
  }, [signOut]);

  const displayName = useMemo(() => {
    if (!user) return null;
    const u = user.username;
    if (u) return u;
    const email = user.primaryEmailAddress?.emailAddress;
    if (email) return email;
    const first = user.firstName;
    const last = user.lastName;
    if (first || last) return [first, last].filter(Boolean).join(" ");
    return "用户";
  }, [user]);

  const value = useMemo<AppAuthValue>(
    () => ({
      mode: "clerk",
      isLoaded,
      userId: user?.id ?? null,
      displayName,
      login,
      logout,
      getApiToken,
    }),
    [isLoaded, user?.id, displayName, login, logout, getApiToken]
  );

  return <AppAuthContext.Provider value={value}>{children}</AppAuthContext.Provider>;
}

/** 与旧项目共用同一 Clerk Application 时，填写相同的 VITE_CLERK_PUBLISHABLE_KEY 即可合并用户池 */
export function AppAuthRoot({ children }: { children: React.ReactNode }) {
  const pk = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY?.trim();
  if (pk) {
    return (
      <ClerkProvider publishableKey={pk} afterSignOutUrl="/">
        <ClerkAuthProvider>{children}</ClerkAuthProvider>
      </ClerkProvider>
    );
  }
  return <LocalAuthProvider>{children}</LocalAuthProvider>;
}
