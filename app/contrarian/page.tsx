// app/contrarian/page.tsx — redirects to /imbalance
import { redirect } from "next/navigation";

export default function ContrarianRedirect() {
  redirect("/imbalance");
}
