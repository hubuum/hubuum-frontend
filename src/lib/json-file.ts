export async function readJsonFileAsPrettyText(file: File): Promise<string> {
  const text = await file.text();

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("Selected file does not contain valid JSON.");
  }

  return JSON.stringify(parsed, null, 2);
}
