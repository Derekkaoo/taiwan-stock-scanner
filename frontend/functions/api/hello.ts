/**
 * Cloudflare Pages Functions: GET /api/hello
 *
 * 用來驗證 Pages Functions 環境跑得起來。
 * 部署後可訪問：
 *   https://<your-preview>.pages.dev/api/hello
 */

export const onRequestGet: PagesFunction = async (context) => {
  const { request } = context

  return Response.json({
    message: 'Hello from Cloudflare Pages Functions\!',
    timestamp: new Date().toISOString(),
    branch: 'feature/favorites-v2',
    method: request.method,
    url: request.url,
  })
}
