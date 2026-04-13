// app/daily/page.tsx — permanent redirect to /brief
import { redirect } from "next/navigation";
export default function DailyRedirect() {
  redirect("/brief");
}
