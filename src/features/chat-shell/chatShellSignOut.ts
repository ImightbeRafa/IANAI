/**
 * Same path as classic Layout: clear the Supabase session, then land on login.
 * Callers must pass AuthContext.signOut (not a raw supabase client).
 */
export async function signOutFromChatShell(options: {
  signOut: () => Promise<void>
  navigate: (to: string) => void
}): Promise<void> {
  await options.signOut()
  options.navigate('/login')
}
