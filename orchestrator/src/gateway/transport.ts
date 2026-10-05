import { GatewayError, safeGatewayError } from "./errors";
import type { AgentGatewayService, GatewayAuthenticationInput } from "./types";

export interface GatewayTransportRequest {
  method: "GET" | "POST" | string;
  path: string;
  contentType?: string;
  body?: string;
  requestId: string;
  source: string;
  /** Opaque input consumed only by the injected GatewayAuthenticator. */
  credentials: unknown;
}

export interface GatewayTransportResponse {
  status: number;
  headers: Readonly<Record<string, string>>;
  body: unknown;
}

const JSON_TYPE = "application/json";
const MAX_SUBMIT_BODY = 12_000;
const MAX_MUTATION_BODY = 2_000;
const SAFE_REQUEST_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

function jsonBody(request: GatewayTransportRequest, maximum: number): Record<string, unknown> {
  if ((request.contentType ?? "").toLowerCase().split(";", 1)[0].trim() !== JSON_TYPE)
    throw new GatewayError("invalid_request", "content-type must be application/json", 415);
  if (
    typeof request.body !== "string" ||
    new TextEncoder().encode(request.body).byteLength > maximum
  )
    throw new GatewayError("invalid_request", "request body is missing or too large", 413);
  try {
    const parsed: unknown = JSON.parse(request.body);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      throw new Error("not an object");
    return parsed as Record<string, unknown>;
  } catch {
    throw new GatewayError("invalid_request", "request body must be a JSON object", 400);
  }
}

function auth(request: GatewayTransportRequest): GatewayAuthenticationInput {
  if (!SAFE_REQUEST_ID.test(request.requestId))
    throw new GatewayError("invalid_request", "requestId is malformed", 400);
  if (
    typeof request.source !== "string" ||
    request.source.length < 1 ||
    request.source.length > 64 ||
    /[\u0000-\u001f\u007f]/.test(request.source)
  )
    throw new GatewayError("invalid_request", "source is malformed", 400);
  return {
    credentials: request.credentials,
    requestId: request.requestId,
    source: request.source,
  };
}

function response(status: number, body: unknown, retryAfter?: number): GatewayTransportResponse {
  return {
    status,
    headers: {
      "content-type": JSON_TYPE,
      "cache-control": "no-store",
      ...(retryAfter === undefined ? {} : { "retry-after": String(retryAfter) }),
    },
    body,
  };
}

/** In-memory HTTP-style adapter. It opens no socket and owns no authentication policy. */
export function createGatewayTransport(service: AgentGatewayService): {
  handle(request: GatewayTransportRequest): Promise<GatewayTransportResponse>;
} {
  return {
    async handle(request) {
      try {
        const authentication = auth(request);
        if (request.method === "POST" && request.path === "/tasks") {
          return response(
            202,
            await service.submitTask({
              authentication,
              request: jsonBody(request, MAX_SUBMIT_BODY),
            }),
          );
        }
        const match = /^\/tasks\/([^/]+)(?:\/(approval)(?:\/(approve|reject))?|\/(pause|cancel))?$/.exec(
          request.path,
        );
        if (!match) throw new GatewayError("not_found", "route not found", 404);
        let taskId: string;
        try {
          taskId = decodeURIComponent(match[1]);
        } catch {
          throw new GatewayError("invalid_request", "taskId encoding is malformed", 400);
        }
        const [, , approval, approvalAction, taskAction] = match;
        if (request.method === "GET") {
          if (request.body !== undefined && request.body !== "")
            throw new GatewayError("invalid_request", "GET requests cannot have a body", 400);
          if (approval && !approvalAction)
            return response(
              200,
              await service.getPendingApproval({ authentication, request: { taskId } }),
            );
          if (!approval && !taskAction)
            return response(
              200,
              await service.getTaskStatus({ authentication, request: { taskId } }),
            );
          throw new GatewayError("not_found", "route not found", 404);
        }
        if (request.method !== "POST")
          throw new GatewayError("invalid_request", "method is not allowed", 405);
        const body = jsonBody(request, MAX_MUTATION_BODY);
        if (Object.hasOwn(body, "taskId"))
          throw new GatewayError("invalid_request", "taskId must come from the route", 400);
        if (taskAction === "pause")
          return response(
            202,
            await service.pauseTask({ authentication, request: { ...body, taskId } }),
          );
        if (taskAction === "cancel")
          return response(
            202,
            await service.cancelTask({ authentication, request: { ...body, taskId } }),
          );
        if (approvalAction === "approve")
          return response(
            200,
            await service.approveTask({ authentication, request: { ...body, taskId } }),
          );
        if (approvalAction === "reject")
          return response(
            200,
            await service.rejectTask({ authentication, request: { ...body, taskId } }),
          );
        throw new GatewayError("not_found", "route not found", 404);
      } catch (error) {
        const safe = safeGatewayError(error);
        return response(
          safe.status,
          { error: { code: safe.code, message: safe.message } },
          safe.retryAfterSeconds,
        );
      }
    },
  };
}
