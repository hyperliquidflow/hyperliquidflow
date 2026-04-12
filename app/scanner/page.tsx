// app/scanner/page.tsx — redirects to /wallets (Discovery tab)
import { redirect } from "next/navigation";

export default function ScannerRedirect() {
  redirect("/wallets");
}
