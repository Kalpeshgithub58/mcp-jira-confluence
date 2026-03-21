type LogLevel = "info" | "warn" | "error" | "debug";

const TOKEN_PATTERNS = [
  /Bearer\s+\S+/gi,
  /token[=:]\s*\S+/gi,
  /pat[=:]\s*\S+/gi,
  /authorization[=:]\s*\S+/gi,
];

function redact(message: string): string {
  let cleaned = message;
  for (const pattern of TOKEN_PATTERNS) {
    cleaned = cleaned.replace(pattern, "[REDACTED]");
  }
  return cleaned;
}

function log(level: LogLevel, message: string, meta?: Record<string, unknown>): void {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    message: redact(message),
    ...(meta ? { meta } : {}),
  };
  const output = JSON.stringify(entry);

  if (level === "error") {
    console.error(output);
  } else if (level === "warn") {
    console.warn(output);
  } else {
    console.log(output);
  }
}

export const logger = {
  info: (message: string, meta?: Record<string, unknown>) => log("info", message, meta),
  warn: (message: string, meta?: Record<string, unknown>) => log("warn", message, meta),
  error: (message: string, meta?: Record<string, unknown>) => log("error", message, meta),
  debug: (message: string, meta?: Record<string, unknown>) => log("debug", message, meta),
};
