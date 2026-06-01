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

    // Hanya terima POST ke /v1/alerts
    if (request.method !== "POST" || url.pathname !== "/v1/alerts") {
      return new Response(JSON.stringify({ error: "Method not allowed or invalid path" }), {
        status: 405,
        headers: { "Content-Type": "application/json" },
      });
    }

    // 1. Validasi API Key
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

    // 2. Validasi Webhook Discord
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

      // 3. Proses & Agregasi Logs ke Embeds Discord
      const embeds = [];
      const now = new Date();

      // Kelompokkan logs untuk menghindari duplikasi visual jika player melakukan hal yang sama berkali-kali
      const aggregatedLogs: { [key: string]: RobloxLog & { count: number } } = {};

      for (const log of payload.logs) {
        const uniqueKey = `${log.player.userId}-${log.level}-${log.reason}`;
        if (aggregatedLogs[uniqueKey]) {
          aggregatedLogs[uniqueKey].count += 1;
        } else {
          aggregatedLogs[uniqueKey] = { ...log, count: 1 };
        }
      }

      // Bangun Discord Embeds dari data ter-agregasi
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

        const countText = item.count > 1 ? ` (Terdeteksi ${item.count}x)` : "";
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
              name: "📋 Detail Kejadian",
              value: item.details || "Tidak ada detail tambahan.",
              inline: false
            }
          ],
          footer: {
            text: `MapGuard Security System • ${now.toISOString()}`
          }
        });

        // Limit embeds Discord maksimal 10 per message payload
        if (embeds.length >= 10) break;
      }

      // 4. Kirim ke Discord Webhook
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
