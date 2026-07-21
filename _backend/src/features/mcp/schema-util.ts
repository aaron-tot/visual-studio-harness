import { z } from "zod";

export function jsonSchemaToZod(schema: Record<string, unknown>): z.ZodTypeAny {
  if (!schema || typeof schema !== "object") return z.any();

  const type = schema.type as string | undefined;

  if (type === "string") {
    const enumVals = schema.enum as string[] | undefined;
    if (enumVals && enumVals.length > 0) {
      return z.enum(enumVals as [string, ...string[]]);
    }
    return z.string();
  }

  if (type === "number" || type === "integer") {
    return type === "integer" ? z.number().int() : z.number();
  }

  if (type === "boolean") {
    return z.boolean();
  }

  if (type === "array") {
    const items = schema.items as Record<string, unknown> | undefined;
    return z.array(items ? jsonSchemaToZod(items) : z.any());
  }

  if (type === "object" || schema.properties) {
    const props = schema.properties as Record<string, unknown> | undefined;
    const required = (schema.required as string[]) ?? [];
    if (props) {
      const shape: Record<string, z.ZodTypeAny> = {};
      for (const [key, prop] of Object.entries(props)) {
        const fieldSchema = jsonSchemaToZod(prop as Record<string, unknown>);
        shape[key] = required.includes(key) ? fieldSchema : fieldSchema.optional();
      }
      return z.object(shape);
    }
    return z.object({}).passthrough();
  }

  return z.any();
}
