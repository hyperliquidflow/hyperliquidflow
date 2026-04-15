// app/performance/page.tsx — permanent redirect to /signals/performance
import { redirect } from "next/navigation";
export default function PerformancePage() { redirect("/signals/performance"); }
