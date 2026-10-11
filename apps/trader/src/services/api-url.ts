const LOCAL_API_URL = 'http://localhost:4000/api/v1';

/** Accept an API origin or an explicit API path prefix. */
export function resolveApiBaseUrl(configuredUrl?: string): string {
  const baseUrl = configuredUrl?.trim().replace(/\/+$/, '');
  if (!baseUrl) return LOCAL_API_URL;
  return /^https?:\/\/[^/?#]+$/i.test(baseUrl) ? `${baseUrl}/api/v1` : baseUrl;
}
