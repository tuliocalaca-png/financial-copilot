import { createClient } from "@supabase/supabase-js";
import { config } from "../core/config";

export const supabase = createClient(config.supabaseUrl, config.supabaseKey);
