// Minimal robots.txt support (User-agent groups, Allow/Disallow, longest-match wins, * and $).

export const BOT_TOKEN = "SprintoResearchBot";

interface Rule { allow: boolean; pattern: string }

export interface RobotsPolicy { isAllowed(path: string): boolean; raw: string | null }

function toRegex(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+?^{}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${escaped.endsWith("\\$") ? escaped.slice(0, -2) + "$" : escaped}`);
}

export function parseRobots(text: string | null, agent = BOT_TOKEN): RobotsPolicy {
  if (!text) return { isAllowed: () => true, raw: null };
  const groups: Array<{ agents: string[]; rules: Rule[] }> = [];
  let current: { agents: string[]; rules: Rule[] } | null = null;
  let lastWasAgent = false;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (!line) continue;
    const idx = line.indexOf(":");
    if (idx < 0) continue;
    const key = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();
    if (key === "user-agent") {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
    } else if ((key === "allow" || key === "disallow") && current) {
      lastWasAgent = false;
      if (key === "disallow" && value === "") continue; // empty disallow = allow all
      current.rules.push({ allow: key === "allow", pattern: value });
    } else {
      lastWasAgent = false;
    }
  }
  const lower = agent.toLowerCase();
  const specific = groups.filter((g) => g.agents.some((a) => a !== "*" && lower.includes(a)));
  const chosen = specific.length ? specific : groups.filter((g) => g.agents.includes("*"));
  const rules = chosen.flatMap((g) => g.rules);
  return {
    raw: text,
    isAllowed(path: string) {
      let best: Rule | null = null;
      for (const rule of rules) {
        if (!toRegex(rule.pattern).test(path)) continue;
        if (!best || rule.pattern.length > best.pattern.length || (rule.pattern.length === best.pattern.length && rule.allow)) {
          best = rule;
        }
      }
      return best ? best.allow : true;
    },
  };
}
