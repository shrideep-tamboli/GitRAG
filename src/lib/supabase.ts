import { createBrowserClient } from '@supabase/ssr'

export const createClient = () => {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}

function parseCookie(cookieString: string) {
  if (cookieString.startsWith('base64-')) {
    // Remove the 'base64-' prefix
    const base64Value = cookieString.replace('base64-', '');
    
    // Decode the base64 string
    const decodedString = Buffer.from(base64Value, 'base64').toString();
    
    // Now parse the decoded string as JSON
    return JSON.parse(decodedString);
  }
  
  // Handle regular JSON cookies
  return JSON.parse(cookieString);
}
