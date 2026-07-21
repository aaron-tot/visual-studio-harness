import { z } from "zod";

export const McpServerConfigSchema = z.object({
  name: z.string().min(1, "Server name is required"),
  enabled: z.boolean().default(true),
  transport: z.enum(["stdio", "http"]),
  command: z.string().optional(),
  args: z.array(z.string()).default([]),
  env: z.record(z.string()).optional(),
  url: z.string().optional(),
  headers: z.record(z.string()).optional(),
});

export type McpServerConfig = z.infer<typeof McpServerConfigSchema>;
