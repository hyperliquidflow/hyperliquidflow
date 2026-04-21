import { redirect } from "next/navigation";

export default async function WalletsRedirect({
  searchParams,
}: {
  searchParams: Promise<{ address?: string }>;
}) {
  const { address } = await searchParams;
  redirect(address ? `/wallets/discovery?address=${address}` : "/wallets/discovery");
}
