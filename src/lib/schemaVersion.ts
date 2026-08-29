import { supabase } from "@/lib/supabase";

/**
 * La migracion mas reciente que esta version de la app necesita.
 *
 * Sube en el mismo commit que la migracion que la requiere. Es el prefijo del
 * fichero en `supabase/migrations/`, y se comparan como texto: al ser de ancho
 * fijo, el orden lexicografico coincide con el cronologico.
 */
export const REQUIRED_SCHEMA_VERSION = "20260828000002";

export type SchemaCheck =
  | { status: "ok" }
  /** El backend va por detras: le faltan migraciones que la app espera. */
  | { status: "behind"; found: string; required: string }
  /**
   * No se pudo determinar. Cubre dos casos que no conviene distinguir aqui:
   * un proyecto anterior a `flux_schema_migrations` (la tabla no existe) y un
   * fallo de red. Ninguno justifica molestar al usuario.
   */
  | { status: "unknown" };

export async function checkSchemaVersion(): Promise<SchemaCheck> {
  const { data, error } = await supabase
    .from("flux_schema_migrations")
    .select("version")
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data?.version) return { status: "unknown" };

  const found = data.version as string;
  return found >= REQUIRED_SCHEMA_VERSION
    ? { status: "ok" }
    : { status: "behind", found, required: REQUIRED_SCHEMA_VERSION };
}
