// app/recipes/page.tsx — permanent redirect to /edge
import { redirect } from "next/navigation";

export default function RecipesRedirect() {
  redirect("/edge");
}
