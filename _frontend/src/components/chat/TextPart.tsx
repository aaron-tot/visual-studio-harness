import { Markdown } from "./markdown";

interface TextPartProps {
  content: string;
}

export function TextPart({ content }: TextPartProps) {
  if (!content) return null;
  return <Markdown content={content} />;
}
