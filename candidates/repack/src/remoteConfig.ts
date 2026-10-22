// Request settings for remote feature scripts, shared by the Module Federation runtime plugin and the Insights
// loader. The public key is a build-time constant compiled into the main (installed) bundle (design §8.10); the
// token header is set from the launch configuration when the server runs on a LAN address (§15.1).
declare const __MB_REMOTE_PUBLIC_KEY__: string;

let headers: Record<string, string> | undefined;

export function setRemoteToken(token: string | null): void {
  headers = token === null ? undefined : { Authorization: `Bearer ${token}` };
}

export function remoteHeaders(): Record<string, string> | undefined {
  return headers;
}

export function remotePublicKey(): string {
  return __MB_REMOTE_PUBLIC_KEY__;
}
