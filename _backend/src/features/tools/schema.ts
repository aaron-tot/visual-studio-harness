import type { z } from "zod";

export interface ToolFieldDef {
  name: string;
  type: string;
  description: string;
  required: boolean;
}

function resolveInner(def: any): { typeName: string; inner: any } {
  if (def.typeName === "ZodOptional") {
    return resolveInner(def.innerType._def);
  }
  return { typeName: def.typeName, inner: def };
}

function formatType(def: any): string {
  const { typeName: tn, inner } = resolveInner(def);
  if (tn === "ZodString") return "string";
  if (tn === "ZodNumber") {
    const isInt = (inner.checks || []).some((c: any) => c.kind === "int");
    return isInt ? "integer" : "number";
  }
  if (tn === "ZodBoolean") return "boolean";
  if (tn === "ZodArray") return `${formatType(inner.type._def)}[]`;
  if (tn === "ZodEnum") return `enum(${inner.values.join(" | ")})`;
  if (tn === "ZodObject") return "object";
  return tn;
}

export function extractToolFields(schema: any): ToolFieldDef[] {
  const def = schema?._def;
  if (!def || def.typeName !== "ZodObject") return [];
  const shape = schema.shape;
  if (!shape) return [];
  return Object.entries(shape).map(([key, val]: [string, any]) => {
    const fieldDef = val._def;
    const isOptional = fieldDef.typeName === "ZodOptional";
    const description = isOptional
      ? fieldDef.description || fieldDef.innerType.description || ""
      : val.description || "";
    return {
      name: key,
      type: formatType(fieldDef),
      description,
      required: !isOptional,
    };
  });
}
