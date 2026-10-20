import { redirect } from "next/navigation";

/** Root redirects to the Plans view. */
export default function RootPage(): never {
  redirect("/plans");
}
