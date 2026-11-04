import { applyEdits } from "jsonc-parser";
import { parseJsonDocument, walkJson } from "../ui/json-document";

const REDACTED = "[REDACTED]";
const secretNames = new Set([
  "authorization", "proxyauthorization", "auth", "authentication", "credentials", "cookie", "cookie2", "cookies", "setcookie", "password", "passwd", "pass", "passphrase",
  "secret", "clientsecret", "privatekey", "secretkey", "token", "accesstoken", "refreshtoken", "idtoken", "authtoken", "jwttoken", "jwt",
  "apikey", "xapikey", "xauthtoken", "xaccesstoken", "csrftoken", "xcsrftoken", "xsrftoken", "xxsrftoken", "session", "sessionid", "sessiontoken",
  "xsessionid", "xsessiontoken", "xauthorization", "xamzsecuritytoken", "xgoogapikey", "cfaccessjwtassertion", "csrf", "xsrf", "clientassertion",
  "xamzcredential", "xamzsignature", "xgoogcredential", "xgoogsignature", "sig", "signature",
]);

export function isCredential(name: string): boolean { return secretNames.has(name.toLowerCase().replace(/[^a-z0-9]/g, "")); }

export function redactUrl(source: string): string {
  try {
    const url = new URL(source);
    if (!/^https?:$/.test(url.protocol)) return source;
    let changed = Boolean(url.username || url.password || url.hash);
    url.username = ""; url.password = ""; url.hash = "";
    const query = new URLSearchParams();
    for (const [name, value] of url.searchParams) {
      const secret = isCredential(name);
      changed ||= secret;
      query.append(name, secret ? REDACTED : value);
    }
    if (!changed) return source;
    url.search = query.toString();
    return url.href;
  } catch { return source; }
}

export function redactText(source: string): string {
  return source.replace(/\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, (value) => `${value.split(/\s/)[0]} ${REDACTED}`)
    .replace(/https?:\/\/[^\s<>"'`]+/gi, (url) => redactUrl(url));
}

export function redactHeaders(headers: readonly { name: string; value: string }[]): { name: string; value: string }[] {
  return headers.filter((header) => !isCredential(header.name)).map((header) => ({ name: header.name, value: redactText(header.value) }));
}

export function redactBody(source: string, mime: string): string {
  if (/^multipart\/form-data\b/i.test(mime)) return "[Multipart body omitted: field credentials cannot be reliably redacted.]";
  const document = parseJsonDocument(source);
  if (document) {
    const edits: { offset: number; length: number; content: string }[] = [];
    let skipUntil = -1;
    for (const { node, key } of walkJson(document.root)) {
      if (node.offset < skipUntil) continue;
      if (isCredential(key)) {
        edits.push({ offset: node.offset, length: node.length, content: JSON.stringify(REDACTED) });
        skipUntil = node.offset + node.length;
      } else if (node.type === "string" && typeof node.value === "string") {
        const value = redactText(node.value);
        if (value !== node.value) edits.push({ offset: node.offset, length: node.length, content: JSON.stringify(value) });
      }
    }
    return applyEdits(source, edits);
  }
  if (mime.toLowerCase().split(";")[0]?.trim() === "application/x-www-form-urlencoded") {
    const values = new URLSearchParams();
    for (const [key, value] of new URLSearchParams(source)) values.append(key, isCredential(key) ? REDACTED : redactText(value));
    return values.toString();
  }
  return redactText(source);
}
