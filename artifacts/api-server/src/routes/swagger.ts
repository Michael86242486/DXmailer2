import { Router, type Request, type Response } from "express";

const BASE = process.env.REPLIT_DEV_DOMAIN
  ? `https://${process.env.REPLIT_DEV_DOMAIN}`
  : "http://localhost:80";

export const openApiSpec = {
  openapi: "3.0.3",
  info: {
    title: "ORACLEX Mail API",
    version: "2.0.0",
    description: `Send transactional emails via Gmail rotation matrix. Auth: \`Authorization: Bearer oraclex_live_...\``,
  },
  servers: [{ url: `${BASE}/api`, description: "ORACLEX API" }],
  components: {
    securitySchemes: {
      BearerAuth: { type: "http", scheme: "bearer", bearerFormat: "ORACLEX API Key" },
    },
    schemas: {
      SendInput: {
        type: "object", required: ["to", "template"],
        properties: {
          to: { type: "string", format: "email", example: "user@example.com" },
          template: { type: "string", enum: ["verification", "otp", "password-reset", "magic-link"], example: "verification" },
          senderName: { type: "string", example: "Acme Corp" },
          data: { type: "object", properties: { code: { type: "string", example: "882941" }, company: { type: "string", example: "Acme" }, date: { type: "string" }, resetUrl: { type: "string" }, magicUrl: { type: "string" } } },
        },
      },
      SendResponse: { type: "object", properties: { messageId: { type: "string", format: "uuid" }, status: { type: "string", enum: ["queued"] } } },
      Stats: { type: "object", properties: { sent: { type: "integer" }, failed: { type: "integer" }, queue: { type: "integer" }, success_rate: { type: "number" } } },
      Usage: { type: "object", properties: { emails_today: { type: "integer" }, email_quota: { type: "integer" }, remaining: { type: "integer" }, pct_used: { type: "number" }, resets_at: { type: "string" } } },
      Error: { type: "object", properties: { error: { type: "string" } } },
    },
  },
  security: [{ BearerAuth: [] }],
  paths: {
    "/v1/email/send": {
      post: {
        tags: ["Email"], summary: "Send a transactional email",
        requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/SendInput" } } } },
        responses: { 202: { description: "Queued", content: { "application/json": { schema: { $ref: "#/components/schemas/SendResponse" } } } }, 401: { description: "Unauthorized" }, 429: { description: "Daily quota exceeded" } },
      },
    },
    "/v1/stats": { get: { tags: ["Stats"], summary: "Delivery statistics", responses: { 200: { description: "OK", content: { "application/json": { schema: { $ref: "#/components/schemas/Stats" } } } } } } },
    "/v1/usage": { get: { tags: ["Stats"], summary: "Today's email usage vs quota", responses: { 200: { description: "Usage", content: { "application/json": { schema: { $ref: "#/components/schemas/Usage" } } } } } } },
    "/v1/email/logs": { get: { tags: ["Logs"], summary: "Paginated delivery logs", parameters: [{ name: "status", in: "query", schema: { type: "string" } }, { name: "page", in: "query", schema: { type: "integer" } }, { name: "limit", in: "query", schema: { type: "integer" } }], responses: { 200: { description: "Logs" } } } },
    "/v1/smtp/pool": { get: { tags: ["Relay"], summary: "Gmail rotation matrix status", responses: { 200: { description: "Nodes" } } } },
    "/v1/webhooks": { get: { tags: ["Webhooks"], summary: "List webhooks", responses: { 200: { description: "OK" } } }, post: { tags: ["Webhooks"], summary: "Register webhook", requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["url"], properties: { url: { type: "string" }, events: { type: "string" } } } } } }, responses: { 201: { description: "Created" } } } },
    "/v1/webhooks/{id}": { delete: { tags: ["Webhooks"], summary: "Delete webhook", parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }], responses: { 200: { description: "Deleted" } } } },
    "/v1/subscribers": { get: { tags: ["Subscribers"], summary: "List subscribers", responses: { 200: { description: "OK" } } }, post: { tags: ["Subscribers"], summary: "Upsert subscriber", requestBody: { required: true, content: { "application/json": { schema: { type: "object" } } } }, responses: { 200: { description: "OK" } } } },
    "/v1/api-keys": {
      get: { tags: ["API Keys"], summary: "List API keys (JWT auth)", responses: { 200: { description: "Keys" } } },
      post: { tags: ["API Keys"], summary: "Create API key (JWT auth)", requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["name"], properties: { name: { type: "string" } } } } } }, responses: { 201: { description: "Created — key shown once" } } },
    },
    "/v1/api-keys/{id}": { delete: { tags: ["API Keys"], summary: "Revoke API key (JWT auth)", parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }], responses: { 200: { description: "Revoked" } } } },
    "/auth/signup": { post: { tags: ["Auth"], summary: "Create account + send OTP", security: [], requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["email","password"], properties: { email: { type: "string" }, password: { type: "string" } } } } } }, responses: { 201: { description: "Check email for OTP" }, 409: { description: "Already registered" } } } },
    "/auth/verify": { post: { tags: ["Auth"], summary: "Verify email OTP → JWT", security: [], requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["email","code"], properties: { email: { type: "string" }, code: { type: "string" } } } } } }, responses: { 200: { description: "JWT token" }, 400: { description: "Bad code" } } } },
    "/auth/login": { post: { tags: ["Auth"], summary: "Login → JWT", security: [], requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["email","password"], properties: { email: { type: "string" }, password: { type: "string" } } } } } }, responses: { 200: { description: "JWT token" }, 401: { description: "Bad credentials" } } } },
  },
};

// Serve Swagger UI via CDN HTML (avoids proxy static-file issues)
const SWAGGER_HTML = (specJson: string, base: string) => `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>ORACLEX Mail API — Swagger UI</title>
<link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5.17.14/swagger-ui.css"/>
<style>
*{box-sizing:border-box}
body{margin:0;background:#000;font-family:-apple-system,sans-serif}
.swagger-ui .topbar{background:#0a0a0a!important;border-bottom:1px solid #1a1a1a}
.swagger-ui .topbar .wrapper{padding:10px 20px}
.swagger-ui .topbar-wrapper a{display:none}
.swagger-ui .topbar-wrapper::before{content:'⚡ ORACLEX Mail API';color:#fff;font-weight:700;font-size:16px;letter-spacing:.1em}
.swagger-ui{background:#000!important}
.swagger-ui .info .title{color:#fff!important}
.swagger-ui .info p,.swagger-ui .info li{color:#aaa!important}
.swagger-ui .scheme-container{background:#0a0a0a!important;border:1px solid #1a1a1a!important;padding:15px 20px}
.swagger-ui .opblock{background:#0a0a0a!important;border-color:#1a1a1a!important;margin-bottom:8px}
.swagger-ui .opblock .opblock-summary{border-color:#1a1a1a!important}
.swagger-ui .opblock-body{background:#060606!important}
.swagger-ui .opblock-section-header{background:#111!important}
.swagger-ui .parameter__name{color:#e8e8e8!important}
.swagger-ui .parameter__type{color:#4a9eff!important}
.swagger-ui table thead tr th{background:#111!important;color:#888!important}
.swagger-ui table tbody tr td{background:#0a0a0a!important;color:#ccc!important;border-color:#1a1a1a!important}
.swagger-ui .response-col_status{color:#4aff7a!important}
.swagger-ui section.models{background:#0a0a0a!important;border-color:#1a1a1a!important}
.swagger-ui .btn{background:#1a1a1a!important;color:#fff!important;border-color:#333!important}
.swagger-ui .btn.execute{background:#fff!important;color:#000!important;font-weight:700}
.swagger-ui input[type=text],.swagger-ui textarea,.swagger-ui select{background:#111!important;color:#e8e8e8!important;border-color:#333!important}
.swagger-ui .dialog-ux .modal-ux{background:#0a0a0a!important;border-color:#222!important}
.swagger-ui .dialog-ux .modal-ux-header{background:#0a0a0a!important;border-color:#222!important;color:#fff!important}
.swagger-ui .dialog-ux .modal-ux-header h3{color:#fff!important}
.swagger-ui .auth-container h4{color:#aaa!important}
.swagger-ui .opblock-tag{color:#fff!important;border-color:#1a1a1a!important}
.swagger-ui .microlight{background:#0d0d0d!important;color:#e8e8e8!important}
.swagger-ui .highlight-code{background:#0a0a0a!important}
.swagger-ui .model-box{background:#111!important}
.swagger-ui .model{color:#ccc!important}
.swagger-ui select{-webkit-appearance:auto}
</style>
</head>
<body>
<div id="swagger-ui"></div>
<script src="https://unpkg.com/swagger-ui-dist@5.17.14/swagger-ui-bundle.js"></script>
<script>
const spec = ${specJson};
SwaggerUIBundle({
  spec,
  dom_id: '#swagger-ui',
  presets: [SwaggerUIBundle.presets.apis, SwaggerUIBundle.SwaggerUIStandalonePreset],
  layout: 'BaseLayout',
  persistAuthorization: true,
  displayRequestDuration: true,
  tryItOutEnabled: true,
  filter: true,
  defaultModelsExpandDepth: 1,
  requestInterceptor: (req) => {
    // Rewrite localhost URLs to the actual origin
    if (req.url.startsWith('http://localhost')) {
      req.url = req.url.replace('http://localhost:80', window.location.origin).replace('http://localhost', window.location.origin);
    }
    return req;
  }
});
</script>
</body>
</html>`;

const router = Router();

router.get("/docs", (_req: Request, res: Response) => {
  const specJson = JSON.stringify(openApiSpec);
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Content-Security-Policy", "default-src 'self' 'unsafe-inline' 'unsafe-eval' https://unpkg.com; connect-src *; img-src * data:");
  res.send(SWAGGER_HTML(specJson, BASE));
});

router.get("/openapi.json", (_req: Request, res: Response) => {
  res.json(openApiSpec);
});

export default router;
