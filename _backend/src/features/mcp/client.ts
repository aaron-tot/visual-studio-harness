import { createTransport, type McpTransport } from "./transport";
import type {
  JsonRpcRequest,
  JsonRpcResponse,
  McpToolDefinition,
  McpListToolsResult,
  McpToolCallResult,
  McpToolCallContent,
  McpServerConfig,
} from "./types";

export class McpClient {
  private transport: McpTransport;
  public tools: McpToolDefinition[] = [];
  private requestId = 0;

  constructor(public config: McpServerConfig) {
    this.transport = createTransport(config);
  }

  get name(): string {
    return this.config.name;
  }

  get connected(): boolean {
    return this.tools.length > 0;
  }

  async connect(): Promise<void> {
    await this.transport.connect();
    await this.discoverTools();
  }

  async disconnect(): Promise<void> {
    this.tools = [];
    await this.transport.disconnect();
  }

  private async discoverTools(): Promise<void> {
    const response = await this.sendRequest({
      method: "tools/list",
      params: {},
    });
    const result = response.result as McpListToolsResult | undefined;
    this.tools = result?.tools ?? [];
  }

  async callTool(
    toolName: string,
    args: Record<string, unknown>,
    signal?: AbortSignal
  ): Promise<string> {
    const response = await this.sendRequest(
      {
        method: "tools/call",
        params: { name: toolName, arguments: args },
      },
      signal
    );

    const result = response.result as McpToolCallResult | undefined;
    if (result?.isError) {
      const text = extractToolResultText(result);
      throw new Error(text || "MCP tool call returned error");
    }
    if (response.error) {
      throw new Error(response.error.message);
    }
    return extractToolResultText(result) ?? "";
  }

  private async sendRequest(
    partial: { method: string; params?: unknown },
    signal?: AbortSignal
  ): Promise<JsonRpcResponse> {
    this.requestId++;
    const request: JsonRpcRequest = {
      jsonrpc: "2.0",
      id: this.requestId,
      ...partial,
    };
    return this.transport.send(request, signal);
  }
}

function extractToolResultText(result: McpToolCallResult | undefined): string | undefined {
  if (!result?.content) return undefined;
  const text = result.content
    .filter((c: McpToolCallContent) => c.type === "text" && typeof c.text === "string")
    .map((c: McpToolCallContent) => c.text)
    .join("\n");
  return text || undefined;
}
