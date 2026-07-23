const bearer = [{ bearerAuth: [] }];
const pathId = (name: string) => [{ name, in: "path", required: true, schema: { type: "string" } }];

export const openApiSpec = {
  openapi: "3.0.3",
  info: {
    title: "ASASU Commission OS API",
    version: "1.0.0",
    description: "Schedule publication, immutable-row claims, duplicate protection, verification, disputes, notifications, and finance settlement."
  },
  servers: [{ url: "http://localhost:4300/api" }],
  security: bearer,
  components: {
    securitySchemes: { bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" } },
    schemas: {
      ClaimSubmission: {
        type: "object",
        required: ["scheduleId", "scheduleEntryIds"],
        properties: {
          scheduleId: { type: "string" },
          scheduleEntryIds: { type: "array", minItems: 1, maxItems: 250, items: { type: "string" } },
          commissionRate: { type: "number", enum: [0.01, 0.015, 0.02] }
        }
      }
    }
  },
  paths: {
    "/auth/login": {
      post: {
        security: [],
        summary: "Authenticate with email and password",
        requestBody: {
          required: true,
          content: { "application/json": { schema: { type: "object", required: ["email", "password"], properties: { email: { type: "string", format: "email" }, password: { type: "string" } } } } }
        },
        responses: { "200": { description: "Authenticated user and access token" }, "401": { description: "Invalid credentials" } }
      }
    },
    "/dashboard": {
      get: { summary: "Get the role-scoped operating view", responses: { "200": { description: "Metrics, latest schedule, claims, disputes, payments, notifications, and audit data" } } }
    },
    "/payment-schedules/preview": {
      post: { summary: "Inspect and validate a schedule workbook without publishing", requestBody: { content: { "multipart/form-data": { schema: { type: "object", required: ["file"], properties: { file: { type: "string", format: "binary" } } } } } }, responses: { "200": { description: "Detected mapping, rows, totals, and warnings" }, "422": { description: "No valid schedule rows" } } }
    },
    "/payment-schedules/upload": {
      post: { summary: "Publish a validated schedule and notify active agents", requestBody: { content: { "multipart/form-data": { schema: { type: "object", required: ["file"], properties: { title: { type: "string" }, file: { type: "string", format: "binary" } } } } } }, responses: { "201": { description: "Published schedule" }, "409": { description: "Duplicate schedule" } } }
    },
    "/payment-schedules/{scheduleId}/entries": {
      get: { summary: "Search and paginate schedule entries", parameters: [...pathId("scheduleId"), { name: "query", in: "query", schema: { type: "string" } }, { name: "state", in: "query", schema: { type: "string", enum: ["ALL", "AVAILABLE", "CLAIMED_BY_YOU", "CLAIMED_BY_ANOTHER"] } }, { name: "page", in: "query", schema: { type: "integer", minimum: 1 } }, { name: "pageSize", in: "query", schema: { type: "integer", minimum: 10, maximum: 100 } }], responses: { "200": { description: "Role-decorated entry page" } } }
    },
    "/claims": {
      post: { summary: "Atomically claim selected schedule rows", requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/ClaimSubmission" } } } }, responses: { "201": { description: "Claim created and rows locked" }, "409": { description: "A selected row is already claimed" } } }
    },
    "/claims/{claimId}/status": {
      patch: { summary: "Approve, partially approve, reject, request information, or mark paid", parameters: pathId("claimId"), responses: { "200": { description: "Updated claim and optional payment" }, "409": { description: "Invalid workflow transition" } } }
    },
    "/claims/{claimId}/messages": {
      post: { summary: "Add a claim conversation message", parameters: pathId("claimId"), responses: { "201": { description: "Updated claim" } } }
    },
    "/disputes": {
      post: { summary: "File an ownership dispute for a claimed schedule row", responses: { "201": { description: "Dispute created and reviewers notified" }, "409": { description: "Row is not eligible for dispute" } } }
    },
    "/disputes/{disputeId}": {
      patch: { summary: "Review, reject, resolve, or transfer a disputed claim", parameters: pathId("disputeId"), responses: { "200": { description: "Updated dispute" } } }
    },
    "/notifications/{notificationId}/read": {
      patch: { summary: "Mark an in-app notification read", parameters: pathId("notificationId"), responses: { "204": { description: "Marked read" } } }
    },
    "/tickets": {
      get: { summary: "List role-scoped support tickets", responses: { "200": { description: "Tickets" } } },
      post: { summary: "Create a support ticket", responses: { "201": { description: "Created ticket" } } }
    },
    "/tickets/{ticketId}/replies": {
      post: { summary: "Reply to a support ticket", parameters: pathId("ticketId"), responses: { "201": { description: "Updated ticket" } } }
    },
    "/payments/export.csv": {
      get: { summary: "Export the finance settlement ledger", responses: { "200": { description: "CSV payment log" } } }
    }
  }
};
