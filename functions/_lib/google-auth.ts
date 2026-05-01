/**
 * Google ID Token 自驗 module（Cloudflare Workers / Pages Functions 用）
 *
 * 設計重點：
 *   - 不依賴 firebase-admin / google-auth-library（Cloudflare Workers 沒有 Node API）
 *   - 純 Web Crypto API + fetch，無外部 dependency
 *   - JWKS 快取 1 小時（Google 約每天輪替一次 key）
 *
 * 使用：
 *   const payload = await verifyGoogleIdToken(idToken, env.GOOGLE_CLIENT_ID)
 *   payload.sub   = 使用者唯一 ID（穩定）
 *   payload.email = 使用者 email（顯示用）
 *   payload.name  = 使用者名稱
 *
 * 驗證項目：
 *   1. JWT signature（用 Google JWKS 的 RSA public key 驗）
 *   2. iss = https://accounts.google.com 或 accounts.google.com
 *   3. aud = 你的 Google Client ID
 *   4. exp > now（沒過期）
 */

const GOOGLE_JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs'
const VALID_ISSUERS = ['https://accounts.google.com', 'accounts.google.com']

export interface GoogleIdTokenPayload {
  iss: string
  aud: string
  sub: string
  email?: string
  email_verified?: boolean
  name?: string
  picture?: string
  given_name?: string
  family_name?: string
  iat: number
  exp: number
}

interface JWK {
  kid: string
  kty: string
  alg: string
  use: string
  n: string
  e: string
}

interface JWKS {
  keys: JWK[]
}

// Module-level JWKS 快取（每個 Worker isolate 獨立）
let jwksCache: { jwks: JWKS; expiresAt: number } | null = null
const JWKS_TTL_MS = 60 * 60 * 1000 // 1 hour

async function fetchJWKS(): Promise<JWKS> {
  const now = Date.now()
  if (jwksCache && jwksCache.expiresAt > now) {
    return jwksCache.jwks
  }
  const resp = await fetch(GOOGLE_JWKS_URL)
  if (!resp.ok) throw new Error(`Failed to fetch Google JWKS: ${resp.status}`)
  const jwks = (await resp.json()) as JWKS
  jwksCache = { jwks, expiresAt: now + JWKS_TTL_MS }
  return jwks
}

// Base64URL → Uint8Array
function base64UrlDecode(s: string): Uint8Array {
  // 補齊 padding 並轉成標準 base64
  const padded = s.replace(/-/g, '+').replace(/_/g, '/')
  const pad = padded.length % 4
  const b64 = pad ? padded + '='.repeat(4 - pad) : padded
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}

// Base64URL → string (UTF-8)
function base64UrlDecodeToString(s: string): string {
  const bytes = base64UrlDecode(s)
  return new TextDecoder().decode(bytes)
}

/**
 * 驗證 Google ID Token，回傳 payload。
 * 失敗會 throw Error，呼叫端要包 try/catch。
 */
export async function verifyGoogleIdToken(
  idToken: string,
  expectedClientId: string,
): Promise<GoogleIdTokenPayload> {
  const parts = idToken.split('.')
  if (parts.length !== 3) {
    throw new Error('Invalid JWT format')
  }
  const [headerB64, payloadB64, signatureB64] = parts

  // Parse header / payload
  let header: { alg: string; kid: string; typ?: string }
  let payload: GoogleIdTokenPayload
  try {
    header = JSON.parse(base64UrlDecodeToString(headerB64))
    payload = JSON.parse(base64UrlDecodeToString(payloadB64))
  } catch {
    throw new Error('Failed to parse JWT header/payload')
  }

  if (header.alg !== 'RS256') {
    throw new Error(`Unsupported alg: ${header.alg}`)
  }

  // 從 JWKS 找出對應的 public key
  const jwks = await fetchJWKS()
  const jwk = jwks.keys.find(k => k.kid === header.kid)
  if (!jwk) {
    throw new Error(`No matching JWK for kid: ${header.kid}`)
  }

  // 用 Web Crypto API 匯入 public key
  const cryptoKey = await crypto.subtle.importKey(
    'jwk',
    {
      kty: jwk.kty,
      n: jwk.n,
      e: jwk.e,
      alg: 'RS256',
      ext: true,
    },
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify'],
  )

  // 驗 signature
  const signedData = new TextEncoder().encode(`${headerB64}.${payloadB64}`)
  const signature = base64UrlDecode(signatureB64)
  const valid = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    cryptoKey,
    signature,
    signedData,
  )
  if (!valid) {
    throw new Error('Invalid signature')
  }

  // 驗 claims
  if (!VALID_ISSUERS.includes(payload.iss)) {
    throw new Error(`Invalid issuer: ${payload.iss}`)
  }
  if (payload.aud !== expectedClientId) {
    throw new Error(`Invalid audience: ${payload.aud}`)
  }
  const nowSec = Math.floor(Date.now() / 1000)
  if (payload.exp < nowSec) {
    throw new Error('Token expired')
  }

  return payload
}

/**
 * 從 Authorization header 取出 Bearer token。
 */
export function getBearerToken(request: Request): string | null {
  const auth = request.headers.get('Authorization') || ''
  const match = /^Bearer\s+(\S+)$/i.exec(auth)
  return match ? match[1] : null
}

/**
 * Helper：驗證 request → 回傳 payload，或 throw Error
 */
export async function authenticateRequest(
  request: Request,
  clientId: string,
): Promise<GoogleIdTokenPayload> {
  const token = getBearerToken(request)
  if (!token) throw new Error('Missing token')
  return verifyGoogleIdToken(token, clientId)
}
