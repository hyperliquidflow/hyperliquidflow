// app/contrarian/page.tsx — permanent redirect to /signals
import { redirect } from "next/navigation";

export default function ContrarianRedirect() {
  redirect("/signals");
}
