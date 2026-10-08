# Reverse Proxy (HTTPS/TLS) — AI Bank Reconciliation Tool

Internet → HTTPS/TLS → reverse proxy → frontend (:3000) / backend
(127.0.0.1:3001). PostgreSQL and Redis are never routed or published.

Use `APP_DOMAIN` (e.g. `app.example.com`) and `API_DOMAIN`
(e.g. `api.example.com`) placeholders below — replace with your domains.
Do not hard-code fake domains anywhere in code.

## Option A — Caddy (automatic TLS, simplest)

```caddyfile
app.example.com {
    reverse_proxy 127.0.0.1:3000
}

api.example.com {
    reverse_proxy 127.0.0.1:3001 {
        # Bank statements / exports can be large; allow headroom.
        request_body_max_size 12MB
    }
    header {
        # HSTS (Caddy adds sane TLS defaults itself)
        Strict-Transport-Security "max-age=31536000; includeSubDomains"
        -Server
    }
}
```

Caddy obtains and renews certificates automatically and redirects
HTTP → HTTPS by default.

## Option B — nginx

```nginx
# HTTP → HTTPS redirect for both hosts.
server {
    listen 80;
    server_name app.example.com api.example.com;
    return 308 https://$host$request_uri;
}

upstream frontend { server 127.0.0.1:3000; }
upstream backend  { server 127.0.0.1:3001; }

limit_req_zone $binary_remote_addr zone=api:10m rate=100r/m;

server {
    listen 443 ssl;
    server_name app.example.com;
    ssl_certificate     /etc/letsencrypt/live/app.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/app.example.com/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header X-Content-Type-Options nosniff always;
    add_header Referrer-Policy no-referrer always;

    location / {
        proxy_pass http://frontend;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto https;
    }
}

server {
    listen 443 ssl;
    server_name api.example.com;
    ssl_certificate     /etc/letsencrypt/live/api.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/api.example.com/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header X-Content-Type-Options nosniff always;
    add_header Referrer-Policy no-referrer always;

    client_max_body_size 12m;   # statement uploads (10 MB) + JSON margin
    proxy_connect_timeout 10s;
    proxy_read_timeout 120s;     # reconciliation runs / PDF exports

    location / {
        limit_req zone=api burst=40 nodelay;
        proxy_pass http://backend;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto https;
    }
}
```

Notes:

- TLS certificates: use Let's Encrypt (`certbot`) or your provider; renew
  automatically and alert on expiry.
- Security headers: the backend also sends helmet headers itself; the
  proxy layer adds HSTS + nosniff as defense in depth.
- Proxy timeouts: reconciliation runs and PDF exports can take up to ~2
  minutes — keep `proxy_read_timeout` ≥ 120 s.
- Request body limits: 12 MB at the proxy matches the 10 MB application
  upload cap with headroom. Never raise this casually.
- Never add `location` blocks for PostgreSQL (5432) or Redis (6379), and
  never publish those ports on the host.
- The Tally Agent connects outbound to `https://API_DOMAIN` only; no
  inbound rule to the Tally PC is ever required.
