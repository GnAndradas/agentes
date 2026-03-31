export function parseJsonSafe<T>(value: string | null | undefined): T | undefined {
  if (!value) return undefined;
  try {
    return JSON.parse(value) as T;
  } catch {
    return undefined;
  }
}

/**
 * Extract JSON from LLM response that may be wrapped in markdown code fences
 *
 * Handles cases like:
 * - Plain JSON: {"key": "value"}
 * - Code fence: ```json\n{"key": "value"}\n```
 * - Code fence without lang: ```\n{"key": "value"}\n```
 * - Surrounding text with embedded JSON
 *
 * @param content Raw LLM response
 * @returns Parsed JSON object
 * @throws Error if no valid JSON found
 */
export function parseJsonFromLLM<T>(content: string): T {
  if (!content || typeof content !== 'string') {
    throw new Error('Empty or invalid content');
  }

  const trimmed = content.trim();

  // Try 1: Direct JSON parse (no fences)
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      return JSON.parse(trimmed) as T;
    } catch {
      // Continue to other strategies
    }
  }

  // Try 2: Extract from markdown code fence
  const fenceMatch = trimmed.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (fenceMatch && fenceMatch[1]) {
    try {
      return JSON.parse(fenceMatch[1].trim()) as T;
    } catch {
      // Continue to other strategies
    }
  }

  // Try 3: Find first complete JSON object/array in text
  const jsonObjectMatch = trimmed.match(/\{[\s\S]*\}/);
  if (jsonObjectMatch) {
    try {
      return JSON.parse(jsonObjectMatch[0]) as T;
    } catch {
      // Try to find a smaller valid JSON object
    }
  }

  const jsonArrayMatch = trimmed.match(/\[[\s\S]*\]/);
  if (jsonArrayMatch) {
    try {
      return JSON.parse(jsonArrayMatch[0]) as T;
    } catch {
      // Continue
    }
  }

  // Try 4: Brute force - find the first valid JSON by iterating
  for (let i = 0; i < trimmed.length; i++) {
    if (trimmed[i] === '{' || trimmed[i] === '[') {
      const closingChar = trimmed[i] === '{' ? '}' : ']';
      let depth = 0;
      let inString = false;
      let escaped = false;

      for (let j = i; j < trimmed.length; j++) {
        const char = trimmed[j];

        if (escaped) {
          escaped = false;
          continue;
        }

        if (char === '\\' && inString) {
          escaped = true;
          continue;
        }

        if (char === '"' && !escaped) {
          inString = !inString;
          continue;
        }

        if (!inString) {
          if (char === trimmed[i]) depth++;
          if (char === closingChar) {
            depth--;
            if (depth === 0) {
              const candidate = trimmed.slice(i, j + 1);
              try {
                return JSON.parse(candidate) as T;
              } catch {
                break; // This block wasn't valid, try next starting point
              }
            }
          }
        }
      }
    }
  }

  throw new Error('No valid JSON found in LLM response');
}

export function toTimestamp(date: Date): number {
  return Math.floor(date.getTime() / 1000);
}

export function fromTimestamp(ts: number): Date {
  return new Date(ts * 1000);
}

export function nowTimestamp(): number {
  return toTimestamp(new Date());
}
