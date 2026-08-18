import { toast } from "sonner";
import { parseQuotaError } from "@/lib/tauri";
import { useNavStore } from "@/stores/nav";

const MONTHS = ["January", "February", "March", "April", "May", "June",
                "July", "August", "September", "October", "November", "December"];

/**
 * Muestra un toast cuando la llamada falló por cuota del tier gratuito y
 * devuelve true. Con cualquier otro error devuelve false, para que quien
 * llama siga mostrándolo como siempre.
 */
export function handleQuotaError(e: unknown): boolean {
  const quota = parseQuotaError(e);
  if (!quota) return false;

  const action = {
    label: "Settings",
    onClick: () => useNavStore.getState().navigate("settings"),
  };
  const byok = "Add your own Claude API key for unlimited use.";

  if (quota.error === "day_limit") {
    toast.error(`Daily AI limit reached (${quota.day_limit} actions)`, {
      description: `Come back tomorrow, or add your own Claude API key.`,
      action, duration: 8000,
    });
  } else if (quota.error === "month_limit") {
    const next = MONTHS[(new Date().getUTCMonth() + 1) % 12];
    toast.error(`Monthly AI limit reached (${quota.month_limit} actions)`, {
      description: `Resets on ${next} 1st. ${byok}`,
      action, duration: 8000,
    });
  } else {
    toast.error("The free AI tier is unavailable right now", {
      description: byok,
      action, duration: 8000,
    });
  }

  return true;
}
