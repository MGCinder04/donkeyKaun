const KEY = "dk-auth-token";

/** The passcode-gate token, stored client-side rather than as a cookie — the client and
 *  API are separate origins in production, which makes a cookie a third-party cookie
 *  that mobile browsers routinely block or evict regardless of its expiry. An explicit
 *  token the app sends itself (Authorization header / socket auth) sidesteps that. */
export function getAuthToken(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function setAuthToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(KEY, token);
    else localStorage.removeItem(KEY);
  } catch {
    // localStorage unavailable (private browsing etc.) — unlock just won't persist
  }
}
