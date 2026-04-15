// app/recipes/page.tsx — permanent redirect to /performance
import { redirect } from "next/navigation";

export default function RecipesRedirect() {
  redirect("/performance");
}
