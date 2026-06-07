import { Router, type Request, type Response } from "express";
import swaggerUi from "swagger-ui-express";

const DARK_CSS = `
  body { background: #000 !important; }
  .swagger-ui { background: #000 !important; }
  .swagger-ui .topbar { background: #0a0a0a !important; border-bottom: 1px solid #1a1a1a; }
  .swagger-ui .topbar .wrapper { padding: 10px 20px; }
  .swagger-ui .topbar-wrapper img { display: none; }
  .swagger-ui .topbar-wrapper::before { content: '⚡ ORACLEX Mail API'; color: #fff; font-weight: 700; font-size: 16px; letter-spacing: .1em; }
  .swagger-ui .info .title { color: #fff !important; }
  .swagger-ui .info p, .swagger-ui .info li { color: #aaa !important; }
  .swagger-ui .scheme-container { background: #0a0a0a !important; border: 1px solid #1a1a1a !important; padding: 15px 20px; }
  .swagger-ui .opblock { background: #0a0a0a !important; border-color: #1a1a1a !important; margin-bottom: 8px; }
  .swagger-ui .opblock .opblock-summary { border-color: #1a1a1a !important; }
  .swagger-ui .opblock .opblock-summary-description { color: #aaa !important; }
  .swagger-ui .opblock-body { background: #060606 !important; }
  .swagger-ui .opblock-section-header { background: #111 !important; }
  .swagger-ui .opblock-section-header label { color: #aaa !important; }
  .swagger-ui .tab li { color: #aaa !important; }
  .swagger-ui .tab li.active { color: #fff !important; }
  .swagger-ui .parameter__name { color: #e8e8e8 !important; }
  .swagger-ui .parameter__type { color: #4a9eff !important; }
  .swagger-ui table thead tr th { background: #111 !important; color: #888 !important; }
  .swagger-ui table tbody tr td { background: #0a0a0a !important; color: #ccc !important; border-color: #1a1a1a !important; }
  .swagger-ui .response-col_status { color: #4aff7a !important; }
  .swagger-ui .model-box { background: #111 !important; }
  .swagger-ui .model { color: #ccc !important; }
  .swagger-ui section.models { background: #0a0a0a !important; border-color: #1a1a1a !important; }
  .swagger-ui section.models .model-container { background: #0a0a0a !important; }
  .swagger-ui .btn { background: #1a1a1a !important; color: #fff !important; border-color: #333 !important; }
  .swagger-ui .btn.execute { background: #fff !important; color: #000 !important; font-weight: 700; }
  .swagger-ui .btn.cancel { background: #1a1a1a !important; color: #aaa !important; }
  .swagger-ui input[type=text], .swagger-ui textarea, .swagger-ui select { background: #111 !important; color: #e8e8e8 !important; border-color: #333 !important; }
  .swagger-ui .auth-wrapper { background: #0a0a0a !important; }
  .swagger-ui .dialog-ux .modal-ux { background: #0a0a0a !important; border-color: #222 !important; }
  .swagger-ui .dialog-ux .modal-ux-header { background: #0a0a0a !important; border-color: #222 !important; }
  .swagger-ui .dialog-ux .modal-ux-header h3 { color: #fff !important; }
  .swagger-ui .auth-container h4 { color: #aaa !important; }
  .swagger-ui .highlighted-code { background: #0a0a0a !important; }
  .swagger-ui .microlight { background: #0d0d0d !important; color: #e8e8e8 !important; }
  .swagger-ui .opblock-tag { color: #fff !important; border-color: #1a1a1a !important; }
  .swagger-ui .opblock-tag:hover { background: #111 !important; }
  .swagger-ui .expand-methods svg, .swagger-ui .expand-operation svg { fill: #aaa !important; }
  .swagger-ui .arrow { fill: #aaa !important; }
`;

export const openApiSpec = {
  openapi: "3.0.3",
  info: {
    title: "ORACLEX Mail API",
    version: "2.0.0",
    description: `## The ORACLEX Mail Engine — Resend-compatible transactional email API

Send HTML emails via Gmail rotation matrix. Returns **202 Accepted** immediately; delivery is asynchronous.

### Authentication
Pass your API key as a **Bearer token**:
\`\`\`
Authorization: Bearer oraclex_live_your_key_here
\`\`\`

### Quick Start
\`\`\`bash
curl -X POST ${process.env.REPLIT_DEV_DOMAIN ? `https://${process.env.REPLIT_DEV_DOMAIN}` : "http://localhost:80"}/api/v1/email/send \\
  -H "Authorization: Bearer oraclex_live_test_key_xyz123" \\
  -H "Content-Type: application/json" \\
  -d '{"to":"you@example.com","template":"verification","data":{"code":"123456","company":"Acme"}}'
\`\`\``,
    contact: { name: "ORACLEX Support", url: "https://oraclex.dev" },
    license: { name: "MIT" },
  },
  servers: [
    {
      url: `${process.env.REPLIT_DEV_DOMAIN ? `https://${process.env.REPLIT_DEV_DOMAIN}` : "http://localhost:80"}/api`,
      description: "ORACLEX API Server",
    },
  ],
  components: {
    securitySchemes: {
      BearerAuth: {
        type: "http",
        scheme: "bearer",
        bearerFormat: "ORACLEX API Key",
        description: "Paste your API key (e.g. `oraclex_live_...`). Get one from the dashboard → API Keys page.",
      },
    },
    schemas: {
      EmailSendInput: {
        type: "object",
        required: ["to", "template"],
        properties: {
          to: { type: "string", format: "email", example: "user@example.com", description: "Recipient email address" },
          template: {
            type: "string",
            enum: ["verification", "otp", "password-reset", "magic-link"],
            example: "verification",
            description: "Template ID to render",
          },
          senderName: { type: "string", example: "Acme Corp", description: "Override the sender display name" },
          data: {
            type: "object",
            description: "Template variables injected into the email body",
            properties: {
              code: { type: "string", example: "882941", description: "OTP / verification code" },
              company: { type: "string", example: "Acme Corp", description: "Company name shown in the email" },
              date: { type: "string", example: "2026", description: "Footer year" },
              resetUrl: { type: "string", format: "uri", description: "Password reset URL (password-reset template)" },
              magicUrl: { type: "string", format: "uri", description: "Magic sign-in URL (magic-link template)" },
            },
          },
        },
      },
      SendEmailResponse: {
        type: "object",
        properties: {
          messageId: { type: "string", format: "uuid", example: "550e8400-e29b-41d4-a716-446655440000" },
          status: { type: "string", enum: ["queued"], example: "queued" },
        },
      },
      Stats: {
        type: "object",
        properties: {
          sent: { type: "integer", example: 42 },
          failed: { type: "integer", example: 3 },
          queue: { type: "integer", example: 0 },
          success_rate: { type: "number", format: "float", example: 93.3 },
        },
      },
      Email: {
        type: "object",
        properties: {
          id: { type: "integer" },
          message_id: { type: "string", format: "uuid" },
          to_address: { type: "string", format: "email" },
          template: { type: "string" },
          status: { type: "string", enum: ["queued", "processing", "sent", "failed"] },
          queued_at: { type: "integer", description: "Unix timestamp" },
          sent_at: { type: "integer", nullable: true },
          error_message: { type: "string", nullable: true },
          relay_node_email: { type: "string", nullable: true },
        },
      },
      SmtpNode: {
        type: "object",
        properties: {
          id: { type: "integer" },
          email: { type: "string" },
          sender_name: { type: "string" },
          status: { type: "string", enum: ["active", "disabled"] },
          daily_sent_count: { type: "integer" },
          max_daily_limit: { type: "integer" },
          utilization_pct: { type: "number" },
          remaining_today: { type: "integer" },
        },
      },
      ApiKeyInput: {
        type: "object",
        required: ["name"],
        properties: {
          name: { type: "string", example: "Production Key", description: "Friendly name for this key" },
        },
      },
      ApiKey: {
        type: "object",
        properties: {
          id: { type: "integer" },
          name: { type: "string" },
          key_prefix: { type: "string", example: "oraclex_live_abc1..." },
          is_active: { type: "boolean" },
          last_used_at: { type: "integer", nullable: true },
          created_at: { type: "integer" },
        },
      },
      ApiKeyCreated: {
        type: "object",
        description: "Only returned once — save the full key immediately",
        properties: {
          id: { type: "integer" },
          name: { type: "string" },
          key: { type: "string", example: "oraclex_live_abc123...", description: "Full key — shown only once" },
          key_prefix: { type: "string" },
          created_at: { type: "integer" },
        },
      },
      Error: {
        type: "object",
        properties: {
          error: { type: "string", example: "Unauthorized" },
        },
      },
      SignupInput: {
        type: "object",
        required: ["email", "password"],
        properties: {
          email: { type: "string", format: "email", example: "you@example.com" },
          password: { type: "string", minLength: 8, example: "supersecret123" },
        },
      },
      LoginInput: {
        type: "object",
        required: ["email", "password"],
        properties: {
          email: { type: "string", format: "email" },
          password: { type: "string" },
        },
      },
      VerifyInput: {
        type: "object",
        required: ["email", "code"],
        properties: {
          email: { type: "string", format: "email" },
          code: { type: "string", example: "882941" },
        },
      },
    },
  },
  security: [{ BearerAuth: [] }],
  tags: [
    { name: "Email", description: "Send transactional emails" },
    { name: "Stats", description: "Delivery statistics" },
    { name: "Relay Pool", description: "Gmail rotation matrix" },
    { name: "Logs", description: "Delivery logs + execution traces" },
    { name: "Webhooks", description: "Event delivery webhooks" },
    { name: "Subscribers", description: "Contact management" },
    { name: "Auth", description: "User signup, login, and API key management" },
    { name: "API Keys", description: "Manage your API keys" },
  ],
  paths: {
    "/v1/email/send": {
      post: {
        tags: ["Email"],
        summary: "Send a transactional email",
        operationId: "sendEmail",
        requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/EmailSendInput" } } } },
        responses: {
          202: { description: "Queued for delivery", content: { "application/json": { schema: { $ref: "#/components/schemas/SendEmailResponse" } } } },
          400: { description: "Bad request", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
          401: { description: "Unauthorized", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
        },
        "x-code-samples": [
          { lang: "cURL", source: `curl -X POST /api/v1/email/send \\\n  -H "Authorization: Bearer oraclex_live_YOUR_KEY" \\\n  -H "Content-Type: application/json" \\\n  -d '{"to":"you@example.com","template":"verification","data":{"code":"882941","company":"Acme"}}'` },
          { lang: "JavaScript", source: `const res = await fetch('/api/v1/email/send', {\n  method: 'POST',\n  headers: { 'Authorization': 'Bearer oraclex_live_YOUR_KEY', 'Content-Type': 'application/json' },\n  body: JSON.stringify({ to: 'you@example.com', template: 'verification', data: { code: '882941', company: 'Acme' } })\n});\nconst { messageId, status } = await res.json();` },
          { lang: "Python", source: `import requests\nr = requests.post('/api/v1/email/send',\n  headers={'Authorization': 'Bearer oraclex_live_YOUR_KEY'},\n  json={'to': 'you@example.com', 'template': 'verification', 'data': {'code': '882941', 'company': 'Acme'}})\nprint(r.json())` },
          { lang: "PHP", source: `$ch = curl_init('/api/v1/email/send');\ncurl_setopt_array($ch, [\n  CURLOPT_POST => 1,\n  CURLOPT_HTTPHEADER => ['Authorization: Bearer oraclex_live_YOUR_KEY', 'Content-Type: application/json'],\n  CURLOPT_POSTFIELDS => json_encode(['to'=>'you@example.com','template'=>'verification','data'=>['code'=>'882941','company'=>'Acme']]),\n  CURLOPT_RETURNTRANSFER => 1\n]);\necho curl_exec($ch);` },
        ],
      },
    },
    "/v1/stats": {
      get: {
        tags: ["Stats"],
        summary: "Get delivery statistics",
        operationId: "getStats",
        responses: {
          200: { description: "Stats", content: { "application/json": { schema: { $ref: "#/components/schemas/Stats" } } } },
          401: { description: "Unauthorized" },
        },
      },
    },
    "/v1/email/logs": {
      get: {
        tags: ["Logs"],
        summary: "List email delivery logs",
        operationId: "getEmailLogs",
        parameters: [
          { name: "status", in: "query", schema: { type: "string", enum: ["queued", "processing", "sent", "failed"] } },
          { name: "page", in: "query", schema: { type: "integer", default: 1 } },
          { name: "limit", in: "query", schema: { type: "integer", default: 20, maximum: 100 } },
        ],
        responses: {
          200: {
            description: "Paginated email logs",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    data: { type: "array", items: { $ref: "#/components/schemas/Email" } },
                    pagination: { type: "object", properties: { page: { type: "integer" }, limit: { type: "integer" }, total: { type: "integer" }, pages: { type: "integer" } } },
                  },
                },
              },
            },
          },
        },
      },
    },
    "/v1/smtp/pool": {
      get: {
        tags: ["Relay Pool"],
        summary: "Gmail rotation matrix status",
        operationId: "getSmtpPool",
        responses: {
          200: { description: "SMTP pool nodes", content: { "application/json": { schema: { type: "array", items: { $ref: "#/components/schemas/SmtpNode" } } } } },
        },
      },
    },
    "/v1/webhooks": {
      get: {
        tags: ["Webhooks"],
        summary: "List registered webhooks",
        operationId: "listWebhooks",
        responses: { 200: { description: "Webhook list" } },
      },
      post: {
        tags: ["Webhooks"],
        summary: "Register a webhook",
        operationId: "createWebhook",
        requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["url"], properties: { url: { type: "string", format: "uri" }, events: { type: "string", example: "sent,failed" } } } } } },
        responses: { 201: { description: "Created" }, 400: { description: "Bad request" } },
      },
    },
    "/v1/webhooks/{id}": {
      delete: {
        tags: ["Webhooks"],
        summary: "Delete a webhook",
        operationId: "deleteWebhook",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
        responses: { 200: { description: "Deleted" }, 404: { description: "Not found" } },
      },
    },
    "/v1/subscribers": {
      get: {
        tags: ["Subscribers"],
        summary: "List subscribers",
        operationId: "listSubscribers",
        parameters: [{ name: "email", in: "query", schema: { type: "string" } }, { name: "page", in: "query", schema: { type: "integer" } }],
        responses: { 200: { description: "Subscriber list" } },
      },
      post: {
        tags: ["Subscribers"],
        summary: "Upsert a subscriber",
        operationId: "upsertSubscriber",
        requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["subscriberId", "email"], properties: { subscriberId: { type: "string" }, email: { type: "string" }, firstName: { type: "string" }, lastName: { type: "string" }, phone: { type: "string" } } } } } },
        responses: { 200: { description: "Subscriber upserted" } },
      },
    },
    "/auth/signup": {
      post: {
        tags: ["Auth"],
        summary: "Create account — sends OTP verification email",
        operationId: "signup",
        security: [],
        requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/SignupInput" } } } },
        responses: {
          201: { description: "Account created — check email for OTP" },
          409: { description: "Email already in use" },
        },
      },
    },
    "/auth/verify": {
      post: {
        tags: ["Auth"],
        summary: "Verify email with OTP",
        operationId: "verifyEmail",
        security: [],
        requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/VerifyInput" } } } },
        responses: { 200: { description: "Verified — returns JWT token" }, 400: { description: "Invalid or expired OTP" } },
      },
    },
    "/auth/login": {
      post: {
        tags: ["Auth"],
        summary: "Login with email + password",
        operationId: "login",
        security: [],
        requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/LoginInput" } } } },
        responses: { 200: { description: "Returns JWT token" }, 401: { description: "Invalid credentials" } },
      },
    },
    "/auth/me": {
      get: {
        tags: ["Auth"],
        summary: "Get current user",
        operationId: "getMe",
        security: [{ BearerAuth: [] }],
        responses: { 200: { description: "Current user info" }, 401: { description: "Unauthorized" } },
      },
    },
    "/v1/api-keys": {
      get: {
        tags: ["API Keys"],
        summary: "List your API keys",
        operationId: "listApiKeys",
        responses: { 200: { description: "API key list (hashes hidden)", content: { "application/json": { schema: { type: "array", items: { $ref: "#/components/schemas/ApiKey" } } } } } },
      },
      post: {
        tags: ["API Keys"],
        summary: "Create a new API key",
        operationId: "createApiKey",
        requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/ApiKeyInput" } } } },
        responses: { 201: { description: "API key created (full key shown only once)", content: { "application/json": { schema: { $ref: "#/components/schemas/ApiKeyCreated" } } } } },
      },
    },
    "/v1/api-keys/{id}": {
      delete: {
        tags: ["API Keys"],
        summary: "Revoke an API key",
        operationId: "revokeApiKey",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
        responses: { 200: { description: "Key revoked" }, 404: { description: "Key not found" } },
      },
    },
  },
};

const router = Router();

// Serve Swagger UI
router.use(
  "/docs",
  swaggerUi.serve,
  swaggerUi.setup(openApiSpec, {
    customCss: DARK_CSS,
    customSiteTitle: "ORACLEX Mail API",
    swaggerOptions: {
      persistAuthorization: true,
      displayRequestDuration: true,
      tryItOutEnabled: true,
      filter: true,
      defaultModelsExpandDepth: 1,
    },
  })
);

// Serve raw spec
router.get("/openapi.json", (_req: Request, res: Response) => {
  res.json(openApiSpec);
});

export default router;
