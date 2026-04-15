// app/edge/page.tsx — permanent redirect to /signals/performance
import { redirect } from "next/navigation";
export default function EdgePage() { redirect("/signals/performance"); }
