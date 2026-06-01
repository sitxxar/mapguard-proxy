export interface Env {
  MAPGUARD_KEY?: string;
  DISCORD_WEBHOOK_URL?: string;
}

interface RobloxLog {
  timestamp: number;
  level: "INFO" | "WARNING" | "CRITICAL";
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

export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext
  ): Promise<Response> {
    const url = new URL(request.url);

    // Endpoint health check
    if (request.method === "GET" && url.pathname === "/health") {
      return new Response(JSON.stringify({ status: "ok", service: "MapGuard Proxy" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Only allow POST requests to /v1/alerts
    if (request.method !== "POST" || url.pathname !== "/v1/alerts") {
      return new Response(JSON.stringify({ error: "Method not allowed or invalid path" }), {
        status: 405,
        headers: { "Content-Type": "application/json" },
      });
    }

    // 1. Validate API Key
    const requestApiKey = request.headers.get("X-MapGuard-Key");
    if (!env.MAPGUARD_KEY) {
      return new Response(JSON.stringify({ error: "Proxy configuration error: MAPGUARD_KEY not set" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (requestApiKey !== env.MAPGUARD_KEY) {
      return new Response(JSON.stringify({ error: "Unauthorized: Invalid API Key" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    // 2. Validate Discord Webhook URL
    if (!env.DISCORD_WEBHOOK_URL) {
      return new Response(JSON.stringify({ error: "Proxy configuration error: DISCORD_WEBHOOK_URL not set" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }

    try {
      const payload: AlertRequestPayload = await request.json();
      if (!payload.logs || !Array.isArray(payload.logs) || payload.logs.length === 0) {
        return new Response(JSON.stringify({ error: "Bad Request: 'logs' must be a non-empty array" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }

      // 3. Process & Aggregate Logs into Discord Embeds
      const embeds = [];
      const now = new Date();

      // Group logs to prevent visual duplication if a player triggers the same event repeatedly
      const aggregatedLogs: { [key: string]: RobloxLog & { count: number } } = {};

      for (const log of payload.logs) {
        const uniqueKey = `${log.player.userId}-${log.level}-${log.reason}`;
        if (aggregatedLogs[uniqueKey]) {
          aggregatedLogs[uniqueKey].count += 1;
        } else {
          aggregatedLogs[uniqueKey] = { ...log, count: 1 };
        }
      }

      // Build Discord Embeds from aggregated data
      for (const key of Object.keys(aggregatedLogs)) {
        const item = aggregatedLogs[key];
        
        let color = 5814783; // Blue (Default INFO)
        let levelEmoji = "ℹ️";
        if (item.level === "WARNING") {
          color = 16756224; // Orange/Yellow
          levelEmoji = "⚠️";
        } else if (item.level === "CRITICAL") {
          color = 16711680; // Red
          levelEmoji = "🚨";
        }

        const countText = item.count > 1 ? ` (Detected ${item.count}x)` : "";
        const playerProfileUrl = `https://www.roblox.com/users/${item.player.userId}/profile`;

        embeds.push({
          title: `${levelEmoji} MapGuard Alert: ${item.reason}${countText}`,
          color: color,
          fields: [
            {
              name: "👤 Player",
              value: `[${item.player.username}](${playerProfileUrl})`,
              inline: true
            },
            {
              name: "🆔 User ID",
              value: `\`${item.player.userId}\``,
              inline: true
            },
            {
              name: "📋 Event Details",
              value: item.details || "No additional details provided.",
              inline: false
            }
          ],
          footer: {
            text: `MapGuard Security System • ${now.toISOString()}`
          }
        });

        // Limit Discord embeds to a maximum of 10 per message payload
        if (embeds.length >= 10) break;
      }

      // 4. Send to Discord Webhook
      const discordResponse = await fetch(env.DISCORD_WEBHOOK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ embeds: embeds })
      });

      if (!discordResponse.ok) {
        const errorText = await discordResponse.text();
        return new Response(JSON.stringify({ error: `Discord Webhook error: ${errorText}` }), {
          status: discordResponse.status,
          headers: { "Content-Type": "application/json" },
        });
      }

      return new Response(JSON.stringify({ success: true, processedAlerts: payload.logs.length }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });

    } catch (err: any) {
      return new Response(JSON.stringify({ error: `Server Error: ${err.message || err}` }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
  },
};
