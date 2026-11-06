FROM denoland/deno:debian-2.9.8

WORKDIR /app
COPY servidor.ts ./
COPY supabase/functions/sri-gateway/gateway.ts supabase/functions/sri-gateway/gateway.ts

USER deno
CMD ["run", "--allow-net", "--allow-env=PORT", "servidor.ts"]
