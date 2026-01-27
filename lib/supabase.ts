
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://xqleyxrftyehodksashu.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhxbGV5eHJmdHllaG9ka3Nhc2h1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk0NDEyNDAsImV4cCI6MjA4NTAxNzI0MH0.d_AFPOGwCAIy8eui6hREyC8uk_iVSL_3IGNVDG9f8XI';

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true
  }
});
