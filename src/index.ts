export interface Env {
  MAPGUARD_KEY?: string;
  DISCORD_WEBHOOK_URL?: string;
}

type AlertLevel = "INFO" | "WARNING" | "CRITICAL";

interface RobloxLog {
  timestamp: number;
  level: AlertLevel;
  player: {
    userId: number;
    username: string;
  };
  reason: string;
  details?: string;
}

interface AlertRequestPayload {
  logs: RobloxLog[];
}

const MAX_BODY_BYTES = 64 * 1024;
const MAX_LOGS_PER_REQUEST = 25;
const MAX_REASON_LENGTH = 180;
const MAX_DETAILS_LENGTH = 900;
const MAX_USERNAME_LENGTH = 32;
const DISCORD_MAX_EMBEDS = 10;
const VALID_LEVELS = new Set<AlertLevel>(["INFO", "WARNING", "CRITICAL"]);

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, Math.max(0, maxLength - 3))}...`;
}

function normalizeString(value: unknown, fallback: string, maxLength: number): string {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  if (!trimmed) return fallback;
  return truncate(trimmed, maxLength);
}

function normalizeLog(value: unknown): RobloxLog | null {
  if (!isRecord(value)) return null;

  const player = value.player;
  if (!isRecord(player)) return null;

  const userId = player.userId;
  if (typeof userId !== "number" || !Number.isInteger(userId) || userId < 0) {
    return null;
  }

  const rawLevel = value.level;
  const level = typeof rawLevel === "string" && VALID_LEVELS.has(rawLevel as AlertLevel)
    ? rawLevel as AlertLevel
    : null;
  if (!level) return null;

  const timestamp = typeof value.timestamp === "number" && Number.isFinite(value.timestamp)
    ? Math.floor(value.timestamp)
    : Math.floor(Date.now() / 1000);

  return {
    timestamp,
    level,
    player: {
      userId,
      username: normalizeString(player.username, "Unknown", MAX_USERNAME_LENGTH),
    },
    reason: normalizeString(value.reason, "Unspecified security event", MAX_REASON_LENGTH),
    details: normalizeString(value.details, "No additional details provided.", MAX_DETAILS_LENGTH),
  };
}

async function parseAlertPayload(request: Request): Promise<AlertRequestPayload | null> {
  const contentLength = Number(request.headers.get("Content-Length") || 0);
  if (contentLength > MAX_BODY_BYTES) return null;

  const rawBody = await request.text();
  if (new TextEncoder().encode(rawBody).length > MAX_BODY_BYTES) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return null;
  }

  if (!isRecord(parsed) || !Array.isArray(parsed.logs)) return null;
  if (parsed.logs.length === 0 || parsed.logs.length > MAX_LOGS_PER_REQUEST) return null;

  const logs = parsed.logs.map(normalizeLog);
  if (logs.some((log) => log === null)) return null;

  return { logs: logs as RobloxLog[] };
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/health") {
      return jsonResponse({ status: "ok", service: "MapGuard Proxy" });
    }

    if (request.method !== "POST" || url.pathname !== "/v1/alerts") {
      return jsonResponse({ error: "Method not allowed or invalid path" }, 405);
    }

    if (!request.headers.get("Content-Type")?.toLowerCase().includes("application/json")) {
      return jsonResponse({ error: "Bad Request: Content-Type must be application/json" }, 400);
    }

    const requestApiKey = request.headers.get("X-MapGuard-Key");
    if (!env.MAPGUARD_KEY) {
      return jsonResponse({ error: "Proxy configuration error: MAPGUARD_KEY not set" }, 500);
    }

    if (requestApiKey !== env.MAPGUARD_KEY) {
      return jsonResponse({ error: "Unauthorized: Invalid API Key" }, 401);
    }

    if (!env.DISCORD_WEBHOOK_URL) {
      return jsonResponse({ error: "Proxy configuration error: DISCORD_WEBHOOK_URL not set" }, 500);
    }

    const payload = await parseAlertPayload(request);
    if (!payload) {
      return jsonResponse({ error: "Bad Request: invalid or oversized logs payload" }, 400);
    }

    const embeds = [];
    const now = new Date();
    const aggregatedLogs: Record<string, RobloxLog & { count: number }> = {};

    for (const log of payload.logs) {
      const uniqueKey = `${log.player.userId}-${log.level}-${log.reason}`;
      if (aggregatedLogs[uniqueKey]) {
        aggregatedLogs[uniqueKey].count += 1;
      } else {
        aggregatedLogs[uniqueKey] = { ...log, count: 1 };
      }
    }

    for (const key of Object.keys(aggregatedLogs)) {
      const item = aggregatedLogs[key];
      let color = 5814783;
      let levelLabel = "INFO";

      if (item.level === "WARNING") {
        color = 16756224;
        levelLabel = "WARNING";
      } else if (item.level === "CRITICAL") {
        color = 16711680;
        levelLabel = "CRITICAL";
      }

      const countText = item.count > 1 ? ` (Detected ${item.count}x)` : "";
      const playerProfileUrl = `https://www.roblox.com/users/${item.player.userId}/profile`;

      embeds.push({
        title: truncate(`[${levelLabel}] MapGuard Alert: ${item.reason}${countText}`, 256),
        color,
        fields: [
          {
            name: "Player",
            value: `[${item.player.username}](${playerProfileUrl})`,
            inline: true,
          },
          {
            name: "User ID",
            value: `\`${item.player.userId}\``,
            inline: true,
          },
          {
            name: "Event Details",
            value: truncate(item.details || "No additional details provided.", 1024),
            inline: false,
          },
        ],
        footer: {
          text: truncate(`MapGuard Security System - ${now.toISOString()}`, 2048),
        },
      });

      if (embeds.length >= DISCORD_MAX_EMBEDS) break;
    }

    const discordResponse = await fetch(env.DISCORD_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ embeds }),
    });

    if (!discordResponse.ok) {
      return jsonResponse({ error: "Discord Webhook delivery failed" }, 502);
    }

    return jsonResponse({ success: true, processedAlerts: payload.logs.length });
  },
};
