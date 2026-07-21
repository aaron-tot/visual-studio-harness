export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: string | number;
  method: string;
  params?: unknown;
}

export interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

export interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: string | number;
  result?: unknown;
  error?: JsonRpcError;
}

export interface McpToolInputSchema {
  type?: string;
  properties?: Record<string, unknown>;
  required?: string[];
  [key: string]: unknown;
}

export interface McpToolDefinition {
  name: string;
  description?: string;
  inputSchema?: McpToolInputSchema;
}

export interface McpListToolsResult {
  tools: McpToolDefinition[];
}

export interface McpToolCallContent {
  type?: string;
  text?: string;
  [key: string]: unknown;
}

export interface McpToolCallResult {
  content?: McpToolCallContent[];
  isError?: boolean;
}

export type McpTransportType = "stdio" | "http" | "tcp";

export interface McpConnectionStatus {
  name: string;
  transport: McpTransportType;
  connected: boolean;
  error?: string;
  toolCount: number;
}
