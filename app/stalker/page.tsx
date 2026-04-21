// app/stalker/page.tsx — redirects to /wallets preserving ?address= param
import { redirect } from "next/navigation";

export default async function StalkerRedirect({
  searchParams,
}: {
  searchParams: Promise<{ address?: string }>;
}) {
  const { address } = await searchParams;
  redirect(address ? `/wallets/discovery?address=${address}` : "/wallets/discovery");
}
