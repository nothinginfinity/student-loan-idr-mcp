import { calculateRepayment } from "./formulas.ts";
import { getDocumentationTemplate } from "./templates.ts";
import type { CalculatorRequest, JsonRpcRequest, TemplateRequest } from "./types.ts";

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "content-type, mcp-protocol-version",
  "access-control-allow-methods": "GET, POST, OPTIONS"
};

const toolDefinitions = [
  {
    name: "calculate_alt_income_student_loan",
    description: "Annualize variable taxable income and estimate federal student-loan payments under RAP, IBR, PAYE, and ICR using a versioned 2026 policy snapshot. Estimates only; official eligibility and billing come from Federal Student Aid and the servicer.",
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
        loan: {
          type: "object",
          properties: {
            principal: { type: "number", minimum: 0 },
            annualInterestRatePercent: { type: "number", minimum: 0 },
            newBorrowerOnOrAfterJuly1_2014: { type: "boolean" },
            hasLoanDisbursedOnOrAfterJuly1_2026: { type: "boolean" },
            icrIncomePercentageFactor: { type: "number", exclusiveMinimum: 0 }
          }
        },
        plans: { type: "array", items: { enum: ["RAP", "IBR", "PAYE", "ICR"] } }
      }
    }
  },
  {
    name: "get_repayment_documentation_template",
    description: "Generate a clean Markdown supporting-statement template for current taxable income, a significant income change, unemployment compensation income, or no current taxable income. The output is a template, not a filing or legal determination.",
    inputSchema: {
      type: "object",
      required: ["templateType"],
      properties: {
        templateType: { enum: ["current_income_statement", "income_change_explanation", "unemployment_income_statement", "no_current_taxable_income_statement"] },
        borrowerName: { type: "string" },
        servicerName: { type: "string" },
        incomeSourceName: { type: "string" },
        incomeSourceAddress: { type: "string" },
        paymentFrequency: { type: "string" },
        grossAmount: { type: "number", minimum: 0 },
        notes: { type: "string" }
      }
    }
  }
] as const;

function jsonRpcResult(id: JsonRpcRequest["id"], result: unknown): Response {
  return new Response(JSON.stringify({ jsonrpc: "2.0", id: id ?? null, result }), { headers: JSON_HEADERS });
}

function jsonRpcError(id: JsonRpcRequest["id"], code: number, message: string, data?: unknown): Response {
  return new Response(JSON.stringify({ jsonrpc: "2.0", id: id ?? null, error: { code, message, ...(data === undefined ? {} : { data }) } }), {
    status: 200,
    headers: JSON_HEADERS
  });
}

function contentResult(value: unknown): { content: { type: "text"; text: string }[]; structuredContent: unknown } {
  return {
    content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }],
    structuredContent: value
  };
}

async function handleMcp(request: Request): Promise<Response> {
  let body: JsonRpcRequest;
  try {
    body = (await request.json()) as JsonRpcRequest;
  } catch {
    return jsonRpcError(null, -32700, "Parse error");
  }

  if (body.jsonrpc !== "2.0" || typeof body.method !== "string") {
    return jsonRpcError(body.id, -32600, "Invalid Request");
  }

  if (body.method === "initialize") {
    return jsonRpcResult(body.id, {
      protocolVersion: "2025-03-26",
      capabilities: { tools: {} },
      serverInfo: { name: "student-loan-idr-mcp", version: "0.1.0" }
    });
  }

  if (body.method === "notifications/initialized") {
    return new Response(null, { status: 202, headers: JSON_HEADERS });
  }

  if (body.method === "ping") return jsonRpcResult(body.id, {});
  if (body.method === "tools/list") return jsonRpcResult(body.id, { tools: toolDefinitions });

  if (body.method === "tools/call") {
    const params = body.params as { name?: string; arguments?: unknown } | undefined;
    if (!params?.name) return jsonRpcError(body.id, -32602, "tools/call requires params.name");

    try {
      if (params.name === "calculate_alt_income_student_loan") {
        return jsonRpcResult(body.id, contentResult(calculateRepayment((params.arguments ?? {}) as CalculatorRequest)));
      }
      if (params.name === "get_repayment_documentation_template") {
        return jsonRpcResult(body.id, contentResult(getDocumentationTemplate((params.arguments ?? {}) as TemplateRequest)));
      }
      return jsonRpcError(body.id, -32601, `Unknown tool: ${params.name}`);
    } catch (error) {
      return jsonRpcResult(body.id, {
        isError: true,
        content: [{ type: "text", text: error instanceof Error ? error.message : "Unknown tool error" }]
      });
    }
  }

  return jsonRpcError(body.id, -32601, `Method not found: ${body.method}`);
}

function home(): Response {
  return new Response(JSON.stringify({
    ok: true,
    name: "student-loan-idr-mcp",
    version: "0.1.0",
    policy_snapshot: "2026-08-27",
    tools: toolDefinitions.map((tool) => tool.name),
    endpoints: ["GET /", "GET /health", "POST /mcp"]
  }, null, 2), { headers: JSON_HEADERS });
}

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: JSON_HEADERS });
    if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/health")) return home();
    if (request.method === "POST" && url.pathname === "/mcp") return handleMcp(request);
    return new Response("Not Found", { status: 404 });
  }
};
