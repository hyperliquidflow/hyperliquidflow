"use client";
import { useState, useCallback, useEffect } from "react";
import type { FollowedWallet } from "@/lib/alert-engine";

const KEY = "hl_followed_wallets";
const EVT = "hl:followed-wallets-changed";

function read(): FollowedWallet[] {
  if (typeof window === "undefined") return [];
  try { return JSON.parse(localStorage.getItem(KEY) ?? "[]"); }
  catch { return []; }
}

function write(wallets: FollowedWallet[]) {
  localStorage.setItem(KEY, JSON.stringify(wallets));
  window.dispatchEvent(new Event(EVT));
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
