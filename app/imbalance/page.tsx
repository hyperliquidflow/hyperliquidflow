// app/imbalance/page.tsx — permanent redirect to /signals
import { redirect } from "next/navigation";

export default function ImbalanceRedirect() {
  redirect("/signals");
}
