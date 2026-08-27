import { calculateRepayment, getPolicyStatus } from "./formulas.ts";
import { getDocumentationTemplate } from "./templates.ts";
import type { CalculatorRequest, TemplateRequest } from "./types.ts";

const SERVER_VERSION = "0.4.0";
const SUPPORTED_PROTOCOL_VERSION = "2025-03-26";
const MAX_REQUEST_BYTES = 64 * 1024;

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "access-control-allow-headers": "authorization, content-type, mcp-protocol-version",
  "access-control-allow-methods": "GET, POST, OPTIONS"
};

interface RateLimiterBinding {
  limit(input: { key: string }): Promise<{ success: boolean }>;
}

interface Env {
  MCP_BEARER_TOKEN?: string;
  MCP_ALLOWED_ORIGINS?: string;
  MCP_RATE_LIMITER?: RateLimiterBinding;
}

type JsonObject = Record<string, unknown>;
type JsonRpcId = string | number | null;
type RuntimeSchema = {
  readonly type?: "object" | "array" | "string" | "number" | "integer" | "boolean";
  readonly required?: readonly string[];
  readonly properties?: Readonly<Record<string, RuntimeSchema>>;
  readonly items?: RuntimeSchema;
  readonly enum?: readonly unknown[];
  readonly minItems?: number;
  readonly maxItems?: number;
  readonly minimum?: number;
  readonly exclusiveMinimum?: number;
  readonly maxLength?: number;
};

class RequestTooLargeError extends Error {}

const loanTypeEnum = [
  "direct_subsidized",
  "direct_unsubsidized",
  "direct_grad_plus",
  "direct_parent_plus",
  "direct_consolidation_no_parent_plus",
  "direct_consolidation_with_parent_plus",
  "ffel_subsidized_stafford",
  "ffel_unsubsidized_stafford",
  "ffel_grad_plus",
  "ffel_parent_plus",
  "ffel_consolidation_no_parent_plus",
  "ffel_consolidation_with_parent_plus",
  "perkins"
] as const;

const toolDefinitions = [
  {
    name: "calculate_alt_income_student_loan",
    description: "Annualize variable taxable income and estimate federal student-loan payments under RAP, IBR, PAYE, and ICR using a versioned 2026 policy snapshot. V0.2 adds explicit loan-type/disbursement eligibility objects and the official 2026 ICR income-percentage-factor table. Estimates only; official eligibility and billing come from Federal Student Aid and the servicer.",
    inputSchema: {
      type: "object",
      required: ["income", "region", "familySize"],
      properties: {
        income: {
          type: "array",
          minItems: 1,
          items: {
            type: "object",
            required: ["cadence"],
            properties: {
              cadence: { enum: ["hourly", "weekly", "biweekly", "semimonthly", "monthly", "annual", "seasonal_lump_sum"] },
              amount: { type: "number", minimum: 0 },
              hourlyRate: { type: "number", minimum: 0 },
              hoursPerWeek: { type: "number", minimum: 0 },
              weeksPerYear: { type: "number", minimum: 0 },
              seasonalPayments: { type: "array", items: { type: "number", minimum: 0 } }
            }
          }
        },
        region: { enum: ["contiguous_us", "alaska", "hawaii"] },
        familySize: { type: "integer", minimum: 1 },
        dependentsClaimedOnFederalTaxReturn: { type: "integer", minimum: 0 },
        estimatedAboveTheLineAdjustments: { type: "number", minimum: 0 },
        adjustedGrossIncomeOverride: { type: "number", minimum: 0 },
        taxFilingStatus: { enum: ["single", "married_filing_jointly", "married_filing_separately", "head_of_household"] },
        loan: {
          type: "object",
          properties: {
            principal: { type: "number", minimum: 0 },
            annualInterestRatePercent: { type: "number", minimum: 0 },
            newBorrowerOnOrAfterJuly1_2014: { type: "boolean" },
            hasLoanDisbursedOnOrAfterJuly1_2026: { type: "boolean", description: "Legacy V0.1 compatibility hint. Prefer eligibilityLoans for V0.2 eligibility assessment." },
            icrIncomePercentageFactor: { type: "number", exclusiveMinimum: 0, description: "Optional explicit override. Usually unnecessary in V0.2 because the 2026 official table is built in." },
            icrIncomeFactorCategory: { enum: ["single", "married_or_head_of_household"] },
            payeNewBorrowerOnOrAfterOct1_2007: { type: "boolean" },
            payeDirectLoanDisbursementOnOrAfterOct1_2011: { type: "boolean" },
            eligibilityLoans: {
              type: "array",
              minItems: 1,
              items: {
                type: "object",
                required: ["loanType", "disbursementPeriod"],
                properties: {
                  loanType: { enum: loanTypeEnum },
                  disbursementPeriod: { enum: ["before_2026_07_01", "on_or_after_2026_07_01"] },
                  inDefault: { type: "boolean" },
                  madeIcrPaymentBeforeJuly1_2028: { type: "boolean" }
                }
              }
            }
          }
        },
        plans: { type: "array", items: { enum: ["RAP", "IBR", "PAYE", "ICR"] } }
      }
    }
  },
  {
    name: "get_repayment_documentation_template",
    description: "Generate truthful supporting-statement documents for current taxable income, a significant income change, unemployment compensation income, or no current taxable income. V0.3 accepts structured incomeSources arrays and can render Markdown, plain text, or privacy-safe printable HTML. Missing caller facts remain explicit placeholders.",
    inputSchema: {
      type: "object",
      required: ["templateType"],
      properties: {
        templateType: { enum: ["current_income_statement", "income_change_explanation", "unemployment_income_statement", "no_current_taxable_income_statement"] },
        outputFormat: { enum: ["markdown", "text", "html"], description: "Defaults to markdown." },
        documentDate: { type: "string", description: "Optional caller-supplied display date. Omitted dates remain [date]." },
        borrowerName: { type: "string" },
        servicerName: { type: "string" },
        incomeSources: {
          type: "array",
          items: {
            type: "object",
            properties: {
              sourceType: { enum: ["employment", "self_employment", "contract", "unemployment", "other"] },
              name: { type: "string" },
              address: { type: "string" },
              grossAmount: { type: "number", minimum: 0 },
              paymentFrequency: { type: "string" },
              notes: { type: "string" }
            }
          }
        },
        incomeSourceName: { type: "string", description: "Legacy single-source compatibility field. Prefer incomeSources." },
        incomeSourceAddress: { type: "string", description: "Legacy single-source compatibility field. Prefer incomeSources." },
        paymentFrequency: { type: "string", description: "Legacy single-source compatibility field. Prefer incomeSources." },
        grossAmount: { type: "number", minimum: 0, description: "Legacy single-source compatibility field. Prefer incomeSources." },
        notes: { type: "string" }
      }
    }
  },
  {
    name: "policy_status",
    description: "Report the calculator's immutable policy snapshot date, supported repayment plans, known PAYE/ICR sunset dates, the effective period of the built-in 2026 ICR factor table, and official source links.",
    inputSchema: {
      type: "object",
      properties: {}
    }
  }
] as const;

const hasOwn = (value: JsonObject, key: string): boolean => Object.prototype.hasOwnProperty.call(value, key);
const isObject = (value: unknown): value is JsonObject => typeof value === "object" && value !== null && !Array.isArray(value);

function allowedOrigin(request: Request, env: Env): boolean {
  const origin = request.headers.get("origin");
  if (origin === null) return true;
  const allowlist = (env.MCP_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  return allowlist.includes(origin);
}

function responseHeaders(request: Request, env: Env): Headers {
  const headers = new Headers(JSON_HEADERS);
  const origin = request.headers.get("origin");
  if (origin !== null && allowedOrigin(request, env)) {
    headers.set("access-control-allow-origin", origin);
    headers.set("vary", "Origin");
  }
  return headers;
}

function jsonRpcResultObject(id: string | number, result: unknown): JsonObject {
  return { jsonrpc: "2.0", id, result };
}

function jsonRpcErrorObject(id: JsonRpcId, code: number, message: string, data?: unknown): JsonObject {
  return { jsonrpc: "2.0", id, error: { code, message, ...(data === undefined ? {} : { data }) } };
}

function jsonResponse(payload: unknown, status: number, request: Request, env: Env, extraHeaders?: Record<string, string>): Response {
  const headers = responseHeaders(request, env);
  for (const [key, value] of Object.entries(extraHeaders ?? {})) headers.set(key, value);
  return new Response(JSON.stringify(payload), { status, headers });
}

function contentResult(value: unknown): { content: { type: "text"; text: string }[]; structuredContent: unknown } {
  return {
    content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }],
    structuredContent: value
  };
}

function validateSchema(value: unknown, schema: RuntimeSchema, path = "arguments"): string[] {
  const issues: string[] = [];

  if (schema.enum && !schema.enum.some((candidate) => Object.is(candidate, value))) {
    issues.push(`${path} must be one of the declared enum values.`);
    return issues;
  }

  if (schema.type === "object") {
    if (!isObject(value)) return [`${path} must be an object.`];
    const properties = schema.properties ?? {};
    for (const required of schema.required ?? []) {
      if (!hasOwn(value, required)) issues.push(`${path}.${required} is required.`);
    }
    for (const key of Object.keys(value)) {
      const childSchema = properties[key];
      if (!childSchema) {
        issues.push(`${path}.${key} is not an allowed field.`);
        continue;
      }
      issues.push(...validateSchema(value[key], childSchema, `${path}.${key}`));
    }
    return issues;
  }

  if (schema.type === "array") {
    if (!Array.isArray(value)) return [`${path} must be an array.`];
    if (schema.minItems !== undefined && value.length < schema.minItems) issues.push(`${path} must contain at least ${schema.minItems} item(s).`);
    if (schema.maxItems !== undefined && value.length > schema.maxItems) issues.push(`${path} must contain at most ${schema.maxItems} item(s).`);
    if (schema.items) value.forEach((item, index) => issues.push(...validateSchema(item, schema.items!, `${path}[${index}]`)));
    return issues;
  }

  if (schema.type === "string") {
    if (typeof value !== "string") return [`${path} must be a string.`];
    if (schema.maxLength !== undefined && value.length > schema.maxLength) issues.push(`${path} exceeds the maximum length of ${schema.maxLength}.`);
    return issues;
  }

  if (schema.type === "number" || schema.type === "integer") {
    if (typeof value !== "number" || !Number.isFinite(value)) return [`${path} must be a finite ${schema.type}.`];
    if (schema.type === "integer" && !Number.isInteger(value)) issues.push(`${path} must be an integer.`);
    if (schema.minimum !== undefined && value < schema.minimum) issues.push(`${path} must be greater than or equal to ${schema.minimum}.`);
    if (schema.exclusiveMinimum !== undefined && value <= schema.exclusiveMinimum) issues.push(`${path} must be greater than ${schema.exclusiveMinimum}.`);
    return issues;
  }

  if (schema.type === "boolean" && typeof value !== "boolean") issues.push(`${path} must be a boolean.`);
  return issues;
}

function validateInitializeParams(value: unknown): string[] {
  if (!isObject(value)) return ["params must be an object."];
  const issues: string[] = [];
  if (typeof value.protocolVersion !== "string") issues.push("params.protocolVersion must be a string.");
  if (!isObject(value.capabilities)) issues.push("params.capabilities must be an object.");
  if (!isObject(value.clientInfo)) {
    issues.push("params.clientInfo must be an object.");
  } else {
    if (typeof value.clientInfo.name !== "string") issues.push("params.clientInfo.name must be a string.");
    if (typeof value.clientInfo.version !== "string") issues.push("params.clientInfo.version must be a string.");
  }
  return issues;
}

function isJsonRpcResponse(value: unknown): boolean {
  if (!isObject(value) || value.jsonrpc !== "2.0") return false;
  const id = value.id;
  if (typeof id !== "string" && typeof id !== "number") return false;
  return hasOwn(value, "result") !== hasOwn(value, "error") && !hasOwn(value, "method");
}

async function handleJsonRpcMessage(value: unknown, batched: boolean): Promise<JsonObject | null> {
  if (isJsonRpcResponse(value)) return null;
  if (!isObject(value) || value.jsonrpc !== "2.0" || typeof value.method !== "string") {
    return jsonRpcErrorObject(null, -32600, "Invalid Request");
  }

  const hasId = hasOwn(value, "id");
  if (!hasId) return null;
  if (typeof value.id !== "string" && typeof value.id !== "number") {
    return jsonRpcErrorObject(null, -32600, "MCP request id must be a string or number.");
  }
  const id = value.id;

  if (value.method === "initialize") {
    if (batched) return jsonRpcErrorObject(id, -32600, "initialize must not be sent in a JSON-RPC batch.");
    const issues = validateInitializeParams(value.params);
    if (issues.length > 0) return jsonRpcErrorObject(id, -32602, "Invalid initialize params", { issues });
    const requestedVersion = (value.params as JsonObject).protocolVersion as string;
    return jsonRpcResultObject(id, {
      protocolVersion: requestedVersion === SUPPORTED_PROTOCOL_VERSION ? requestedVersion : SUPPORTED_PROTOCOL_VERSION,
      capabilities: { tools: {} },
      serverInfo: { name: "student-loan-idr-mcp", version: SERVER_VERSION }
    });
  }

  if (value.method === "ping") return jsonRpcResultObject(id, {});
  if (value.method === "tools/list") return jsonRpcResultObject(id, { tools: toolDefinitions });

  if (value.method === "tools/call") {
    const params = value.params;
    if (!isObject(params) || typeof params.name !== "string") {
      return jsonRpcErrorObject(id, -32602, "tools/call requires an object params value with a string name.");
    }
    const definition = toolDefinitions.find((tool) => tool.name === params.name);
    if (!definition) return jsonRpcErrorObject(id, -32601, `Unknown tool: ${params.name}`);
    const toolArguments = params.arguments ?? {};
    const issues = validateSchema(toolArguments, definition.inputSchema as RuntimeSchema);
    if (issues.length > 0) return jsonRpcErrorObject(id, -32602, "Invalid tool arguments", { issues });

    try {
      if (params.name === "calculate_alt_income_student_loan") {
        return jsonRpcResultObject(id, contentResult(calculateRepayment(toolArguments as CalculatorRequest)));
      }
      if (params.name === "get_repayment_documentation_template") {
        return jsonRpcResultObject(id, contentResult(getDocumentationTemplate(toolArguments as TemplateRequest)));
      }
      if (params.name === "policy_status") {
        return jsonRpcResultObject(id, contentResult(getPolicyStatus()));
      }
      return jsonRpcErrorObject(id, -32601, `Unknown tool: ${params.name}`);
    } catch (error) {
      return jsonRpcResultObject(id, {
        isError: true,
        content: [{ type: "text", text: error instanceof Error ? error.message : "Unknown tool error" }]
      });
    }
  }

  return jsonRpcErrorObject(id, -32601, `Method not found: ${value.method}`);
}

async function readRequestText(request: Request): Promise<{ text: string; bytes: number }> {
  const declaredLength = request.headers.get("content-length");
  if (declaredLength !== null) {
    const parsedLength = Number(declaredLength);
    if (Number.isFinite(parsedLength) && parsedLength > MAX_REQUEST_BYTES) throw new RequestTooLargeError("Request body too large");
  }
  if (!request.body) return { text: "", bytes: 0 };

  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  let bytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > MAX_REQUEST_BYTES) {
      await reader.cancel("request body exceeded limit");
      throw new RequestTooLargeError("Request body too large");
    }
    text += decoder.decode(value, { stream: true });
  }
  text += decoder.decode();
  return { text, bytes };
}

function requestMetadata(value: unknown): { method: string; tool?: string } {
  if (Array.isArray(value)) return { method: "batch" };
  if (!isObject(value) || typeof value.method !== "string") return { method: "invalid" };
  if (value.method === "tools/call" && isObject(value.params) && typeof value.params.name === "string") {
    return { method: value.method, tool: value.params.name };
  }
  return { method: value.method };
}

function logRequest(event: { method: string; tool?: string; httpStatus: number; requestBytes: number; durationMs: number }): void {
  console.log(JSON.stringify({
    service: "student-loan-idr-mcp",
    version: SERVER_VERSION,
    event: "mcp_request",
    method: event.method,
    ...(event.tool === undefined ? {} : { tool: event.tool }),
    http_status: event.httpStatus,
    request_bytes: event.requestBytes,
    duration_ms: event.durationMs
  }));
}

async function handleMcp(request: Request, env: Env): Promise<Response> {
  const startedAt = Date.now();
  let requestBytes = 0;
  let metadata: { method: string; tool?: string } = { method: "unparsed" };
  const finish = (response: Response): Response => {
    logRequest({ ...metadata, httpStatus: response.status, requestBytes, durationMs: Date.now() - startedAt });
    return response;
  };

  if (!allowedOrigin(request, env)) {
    return finish(jsonResponse(jsonRpcErrorObject(null, -32600, "Forbidden Origin"), 403, request, env));
  }

  if (env.MCP_BEARER_TOKEN && request.headers.get("authorization") !== `Bearer ${env.MCP_BEARER_TOKEN}`) {
    return finish(jsonResponse(jsonRpcErrorObject(null, -32600, "Unauthorized"), 401, request, env, { "www-authenticate": "Bearer" }));
  }

  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.includes("application/json")) {
    return finish(jsonResponse(jsonRpcErrorObject(null, -32600, "Content-Type must be application/json."), 415, request, env));
  }

  const accept = request.headers.get("accept")?.toLowerCase() ?? "";
  if (!accept.includes("application/json") || !accept.includes("text/event-stream")) {
    return finish(jsonResponse(jsonRpcErrorObject(null, -32600, "Accept must include application/json and text/event-stream."), 406, request, env));
  }

  if (env.MCP_RATE_LIMITER) {
    try {
      const { success } = await env.MCP_RATE_LIMITER.limit({ key: env.MCP_BEARER_TOKEN ? "authenticated:/mcp" : "public:/mcp" });
      if (!success) return finish(jsonResponse(jsonRpcErrorObject(null, -32000, "Rate limit exceeded"), 429, request, env));
    } catch {
      return finish(jsonResponse(jsonRpcErrorObject(null, -32603, "Rate limiter unavailable"), 503, request, env));
    }
  }

  let text: string;
  try {
    const bounded = await readRequestText(request);
    text = bounded.text;
    requestBytes = bounded.bytes;
  } catch (error) {
    if (error instanceof RequestTooLargeError) {
      return finish(jsonResponse(jsonRpcErrorObject(null, -32600, `Request body exceeds ${MAX_REQUEST_BYTES} bytes.`), 413, request, env));
    }
    return finish(jsonResponse(jsonRpcErrorObject(null, -32603, "Unable to read request body"), 400, request, env));
  }

  let body: unknown;
  try {
    body = JSON.parse(text) as unknown;
  } catch {
    return finish(jsonResponse(jsonRpcErrorObject(null, -32700, "Parse error"), 200, request, env));
  }
  metadata = requestMetadata(body);

  if (Array.isArray(body)) {
    if (body.length === 0) return finish(jsonResponse(jsonRpcErrorObject(null, -32600, "Invalid Request"), 200, request, env));
    const responses: JsonObject[] = [];
    for (const item of body) {
      const response = await handleJsonRpcMessage(item, true);
      if (response) responses.push(response);
    }
    if (responses.length === 0) return finish(new Response(null, { status: 202, headers: responseHeaders(request, env) }));
    return finish(jsonResponse(responses, 200, request, env));
  }

  const response = await handleJsonRpcMessage(body, false);
  if (!response) return finish(new Response(null, { status: 202, headers: responseHeaders(request, env) }));
  return finish(jsonResponse(response, 200, request, env));
}

function home(request: Request, env: Env): Response {
  return jsonResponse({
    ok: true,
    name: "student-loan-idr-mcp",
    version: SERVER_VERSION,
    protocol_version: SUPPORTED_PROTOCOL_VERSION,
    policy_snapshot: "2026-08-27",
    tools: toolDefinitions.map((tool) => tool.name),
    endpoints: ["GET /", "GET /health", "POST /mcp"],
    hardening: {
      max_request_bytes: MAX_REQUEST_BYTES,
      bearer_auth_configured: Boolean(env.MCP_BEARER_TOKEN),
      origin_allowlist_configured: Boolean(env.MCP_ALLOWED_ORIGINS),
      rate_limit_configured: Boolean(env.MCP_RATE_LIMITER),
      sensitive_payload_logging: false
    }
  }, 200, request, env);
}

export default {
  async fetch(request: Request, env: Env = {}): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "OPTIONS" && url.pathname === "/mcp") {
      if (!allowedOrigin(request, env)) return jsonResponse(jsonRpcErrorObject(null, -32600, "Forbidden Origin"), 403, request, env);
      return new Response(null, { status: 204, headers: responseHeaders(request, env) });
    }
    if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/health")) return home(request, env);
    if (url.pathname === "/mcp" && request.method === "GET") {
      if (!allowedOrigin(request, env)) return jsonResponse(jsonRpcErrorObject(null, -32600, "Forbidden Origin"), 403, request, env);
      return new Response("SSE listening is not implemented by this stateless server.", { status: 405, headers: { allow: "POST, OPTIONS" } });
    }
    if (request.method === "POST" && url.pathname === "/mcp") return handleMcp(request, env);
    return new Response("Not Found", { status: 404 });
  }
};
