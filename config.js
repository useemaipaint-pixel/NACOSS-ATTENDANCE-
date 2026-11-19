/*
 * NACOSS ONLINE DATABASE SETTINGS (Supabase)
 * ------------------------------------------
 * Cika wadannan guda biyu, sannan app din zai yi sync da database ta yanar gizo.
 * Fill these two values and the app will sync with the online database.
 * Idan babu komai, app din yana aiki a wayar kawai (offline).
 *
 * Yi amfani da "anon / publishable" key kawai. KADA ka sa "service_role" key a nan.
 */
window.NACOSS_CONFIG = {
  SUPABASE_URL: "https://mnoyrtxgosorgwbshofp.supabase.co",   // misali: https://abcdxyz.supabase.co
  SUPABASE_KEY: "sb_publishable_TBiUh5znV17FXpRQgrhnPA_SD1ywHWX",   // anon / publishable key
  TABLE: "nacoss_records",
  SYNC_EVERY_SECONDS: 30
};
