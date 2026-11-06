export function formatAssistantAnswer(answer: string, question: string) {
  let formatted = answer.trim()
    .replace(/^I can help you think through this[^.!?]*[.!?]\s*/i, "")
    .replace(/\\\.(?=\s|$)/g, ".");
  // Small local models often place an entire numbered list in one paragraph.
  // Move inline step markers onto their own lines so the chat can render an <ol>.
  formatted = formatted.replace(/([.!?:])\s+(\d{1,2})[.)]\s+(?=[A-Z\u00c0-\u00de])/g, "$1\n$2. ");
  const hasList = /(^|\n)\s*(?:[-*\u2022]|\d+[.)])\s+/m.test(formatted);
  const asksForSteps = hasList || /\b(what should|how do|how can|what do i|can i|until|first aid|bleed|bleeding|cpr|burn|chok|breath|unconscious|wound|instruction|steps)\b/i.test(question);
  if (!asksForSteps) return formatted;

  const output: string[] = [];
  let pendingStep: number | null = null;

  for (const sourceLine of formatted.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)) {
    const wasBulleted = /^[-*\u2022]\s+/.test(sourceLine);
    const line = sourceLine.replace(/^[-*\u2022]\s+/, "").trim();
    if (/^(?:sure|certainly|of course)[!.]?$/i.test(line)) {
      output.push(line);
      continue;
    }

    const duplicatedMarker = line.match(/^(?:(\d+)[.)]\s+)?(\d+)[.)]$/);
    if (duplicatedMarker) {
      pendingStep = Number(duplicatedMarker[2]);
      continue;
    }

    const introWithMarker = line.match(/^(.*\b(?:steps|procedure|instructions)\b.*?)(\d+)[.)]$/i);
    if (introWithMarker) {
      output.push(introWithMarker[1].trim());
      pendingStep = Number(introWithMarker[2]);
      continue;
    }

    const numbered = line.match(/^(\d+)[.)]\s*(.+)$/);
    if (pendingStep !== null) {
      const content = numbered?.[2] ?? line;
      output.push(pendingStep + ". " + content);
      pendingStep = null;
      continue;
    }
    if (numbered) {
      output.push(numbered[1] + ". " + numbered[2]);
      continue;
    }

    output.push(wasBulleted ? "- " + line : line);
  }

  formatted = output.join("\n");
  if (!/(^|\n)\s*(?:\d+[.)]\s+|[-*\u2022]\s+)/m.test(formatted)) {
    const sentences = formatted.split(/(?<=[.!?])\s+/).map((sentence) => sentence.trim()).filter(Boolean);
    if (sentences.length >= 3) formatted = sentences.map((sentence) => "- " + sentence).join("\n");
  }
  return formatted;
}
