import { LogoutButton } from "./logout-button";
import { EntraLogoutForm } from "./entra-logout-form";
/** Only the public provider name crosses this presentation boundary. */
export function SelectedLogout({
  provider,
}: {
  provider: "supabase" | "entra";
}) {
  return provider === "entra" ? <EntraLogoutForm /> : <LogoutButton />;
}
