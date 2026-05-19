export interface Config {
  jiraBaseUrl: string;
  jiraPat: string;
  confluenceBaseUrl: string;
  confluencePat: string;
  port: number;
}

export function loadConfig(): Config {
  const vars: Record<string, string | undefined> = {
    JIRA_BASE_URL: process.env.JIRA_BASE_URL,
    JIRA_PAT: process.env.JIRA_PAT,
    CONFLUENCE_BASE_URL: process.env.CONFLUENCE_BASE_URL,
    CONFLUENCE_PAT: process.env.CONFLUENCE_PAT,
  };

  // Log independent status for each service
  const jiraMissing = Object.entries(vars)
    .filter(([key, value]) => key.startsWith("JIRA_") && !value)
    .map(([key]) => key);

  const confluenceMissing = Object.entries(vars)
    .filter(([key, value]) => key.startsWith("CONFLUENCE_") && !value)
    .map(([key]) => key);

  if (jiraMissing.length > 0) {
    console.warn(
      `[JIRA] ⚠ Disabled — missing: ${jiraMissing.join(", ")}. Jira tools will return errors when called.`
    );
  } else {
    console.log(`[JIRA] ✓ Enabled — ${vars.JIRA_BASE_URL}`);
  }

  if (confluenceMissing.length > 0) {
    console.warn(
      `[CONFLUENCE] ⚠ Disabled — missing: ${confluenceMissing.join(", ")}. Confluence tools will return errors when called.`
    );
  } else {
    console.log(`[CONFLUENCE] ✓ Enabled — ${vars.CONFLUENCE_BASE_URL}`);
  }

  return {
    jiraBaseUrl: (vars.JIRA_BASE_URL || "").replace(/\/+$/, ""),
    jiraPat: vars.JIRA_PAT || "",
    confluenceBaseUrl: (vars.CONFLUENCE_BASE_URL || "").replace(/\/+$/, ""),
    confluencePat: vars.CONFLUENCE_PAT || "",
    port: parseInt(process.env.PORT || "8000", 10),
  };
}

/** Returns a list of missing config fields for Jira */
export function validateJiraConfig(config: Config): string[] {
  const missing: string[] = [];
  if (!config.jiraBaseUrl) missing.push("JIRA_BASE_URL");
  if (!config.jiraPat) missing.push("JIRA_PAT");
  return missing;
}

/** Returns a list of missing config fields for Confluence */
export function validateConfluenceConfig(config: Config): string[] {
  const missing: string[] = [];
  if (!config.confluenceBaseUrl) missing.push("CONFLUENCE_BASE_URL");
  if (!config.confluencePat) missing.push("CONFLUENCE_PAT");
  return missing;
}
