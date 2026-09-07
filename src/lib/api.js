export const DEFAULT_API_URL =
  "https://script.google.com/macros/s/AKfycbz73zh976OWSsnc32KwFKPVUU3oq7qENQsvKvix2ZexRwHZOldrMk2X37jgD9AUix34/exec";
export class ApiError extends Error {
  constructor(message, code) {
    super(message);
    this.code = code;
  }
}
export function validateEndpoint(endpoint) {
  return /^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z\d_-]+\/exec$/.test(
    endpoint,
  );
}
export async function request(endpoint, key, action, payload = {}) {
  if (!validateEndpoint(endpoint))
    throw new Error("Apps Script の /exec URL を入力してください。");
  if (!key) throw new Error("アクセスキーを入力してください。");
  let response;
  try {
    // A simple POST avoids CORS preflight; Google ContentService redirects are followed.
    response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ action, key, ...payload }),
      redirect: "follow",
      credentials: "omit",
      signal: AbortSignal.timeout(90000),
    });
  } catch {
    throw new ApiError(
      "接続できませんでした。公開設定と URL を確認してください。保存中だった場合は再読込で結果を確認してください。",
      "NETWORK",
    );
  }
  let data;
  try {
    data = await response.json();
  } catch {
    throw new ApiError(
      "API が JSON を返しませんでした。Apps Script の公開設定を確認してください。",
      "INVALID_RESPONSE",
    );
  }
  if (!response.ok || !data.ok)
    throw new ApiError(
      data.error?.message || "リクエストに失敗しました。",
      data.error?.code || "API_ERROR",
    );
  return data.data;
}
