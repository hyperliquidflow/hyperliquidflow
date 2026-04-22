"use client";
import { useState, useCallback, useEffect } from "react";
import type { FollowedWallet } from "@/lib/alert-engine";
import { safeReadJson, safeWriteJson } from "./safe-local-storage";

const KEY = "hl_followed_wallets";
const EVT = "hl:followed-wallets-changed";

function read(): FollowedWallet[] {
  return safeReadJson<FollowedWallet[]>(KEY, []);
}

function write(wallets: FollowedWallet[]) {
  safeWriteJson(KEY, wallets);
  if (typeof window !== "undefined") window.dispatchEvent(new Event(EVT));
}

export function useFollowedWallets() {
  const [wallets, setWallets] = useState<FollowedWallet[]>([]);

  useEffect(() => {
    setWallets(read());
    const handler = () => setWallets(read());
    window.addEventListener(EVT, handler);
    return () => window.removeEventListener(EVT, handler);
  }, []);

  const follow = useCallback((w: FollowedWallet) => {
    const next = [...read().filter(x => x.address !== w.address), w];
    write(next); setWallets(next);
  }, []);

  const unfollow = useCallback((address: string) => {
    const next = read().filter(x => x.address !== address);
    write(next); setWallets(next);
  }, []);

  const update = useCallback((address: string, patch: Partial<FollowedWallet>) => {
    const next = read().map(x => x.address === address ? { ...x, ...patch } : x);
    write(next); setWallets(next);
  }, []);

  const isFollowing = useCallback(
    (address: string) => wallets.some(w => w.address === address),
    [wallets],
  );

  return { wallets, follow, unfollow, update, isFollowing };
}
