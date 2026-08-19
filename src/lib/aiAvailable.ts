import { useSettingsStore } from "@/stores/settings";
import { useUserStore } from "@/stores/user";

/**
 * Si se pueden usar las funciones de IA: con key propia, o con sesion iniciada
 * a traves del tier gratuito. Antes cada pantalla comprobaba `claudeApiKey`
 * directamente, asi que el tier gratuito quedaba bloqueado en tres de las cinco.
 */
export function useAiAvailable(): boolean {
  const ownKey = useSettingsStore(s => !!s.claudeApiKey && s.useOwnKey);
  const signedIn = useUserStore(s => !!s.session);
  return ownKey || signedIn;
}
