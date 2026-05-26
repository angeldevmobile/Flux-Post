import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://zmzfupygrhseljaxzyeb.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InptemZ1cHlncmhzZWxqYXh6eWViIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk2NzgyMzMsImV4cCI6MjA5NTI1NDIzM30.VgIxmqdOkpNowAF4MHaMT9gSV3fM72TNQQjBB3WLZ-Q";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    storageKey: "flux-session",
    detectSessionInUrl: false,
    flowType: "pkce",
  },
});
