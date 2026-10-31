import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

// What's installed for each agent: plugins and what they bring, skills, agents, hooks, MCP servers, memory files.
// Only names and counts are read; settings values (which can hold tokens) are never returned.

const json = file => { try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return null; } };
const list = dir => { try { return readdirSync(dir, { withFileTypes: true }); } catch { return []; } };
function countFiles(dir, test, depth = 4) {
  if (depth < 0) return 0;
  return list(dir).reduce((n, e) => n + (e.isDirectory() ? countFiles(join(dir, e.name), test, depth - 1) : test(e.name) ? 1 : 0), 0);
}
const hookEvents = hooks => Object.keys(hooks ?? {});

function pluginContents(dir) {
  const manifest = json(join(dir, '.claude-plugin', 'plugin.json')) ?? {};
  const hookFiles = [].concat(manifest.hooks ?? []).filter(h => typeof h === 'string');
  const hooks = new Set([...hookEvents(json(join(dir, 'hooks', 'hooks.json'))?.hooks),
    ...hookFiles.flatMap(f => hookEvents(json(join(dir, f))?.hooks)), ...hookEvents(typeof manifest.hooks === 'object' && !Array.isArray(manifest.hooks) ? manifest.hooks : null)]);
  return {
    skills: countFiles(join(dir, 'skills'), n => n === 'SKILL.md'),
    commands: countFiles(join(dir, 'commands'), n => /\.(md|toml)$/.test(n), 1),
    agents: countFiles(join(dir, 'agents'), n => n.endsWith('.md'), 1),
    hooks: [...hooks],
    mcpServers: Object.keys(json(join(dir, '.mcp.json'))?.mcpServers ?? json(join(dir, '.mcp.json')) ?? {}),
  };
}

function claudeCatalog(home) {
  const dir = join(home, '.claude'), settings = json(join(dir, 'settings.json')) ?? {}, root = json(join(home, '.claude.json')) ?? {};
  const installed = json(join(dir, 'plugins', 'installed_plugins.json'))?.plugins ?? {};
  const plugins = Object.entries(installed).map(([name, entries]) => {
    const e = [].concat(entries)[0] ?? {};
    return { name, enabled: settings.enabledPlugins?.[name] !== false, version: e.version ?? null, ...(e.installPath ? pluginContents(e.installPath) : {}) };
  });
  const mcp = new Set([...Object.keys(root.mcpServers ?? {}), ...Object.values(root.projects ?? {}).flatMap(p => Object.keys(p.mcpServers ?? {}))]);
  return {
    plugins,
    skills: countFiles(join(dir, 'skills'), n => n === 'SKILL.md'),
    agents: countFiles(join(dir, 'agents'), n => n.endsWith('.md'), 1),
    hooks: hookEvents(settings.hooks),
    mcpServers: [...mcp].sort(),
    statusLine: Boolean(settings.statusLine),
    memory: { globalInstructions: existsSync(join(dir, 'CLAUDE.md')), projectMemories: list(join(dir, 'projects')).reduce((n, p) => n + countFiles(join(dir, 'projects', p.name, 'memory'), f => f.endsWith('.md') && f !== 'MEMORY.md', 1), 0) },
  };
}

// config.toml is read for section names and `enabled = false` only.
function codexCatalog(home) {
  const dir = join(home, '.codex');
  let toml = '';
  try { toml = readFileSync(join(dir, 'config.toml'), 'utf8'); } catch {}
  const sections = [...toml.matchAll(/^\[([^\]\n]+)\]\s*\n((?:(?!\[)[^\n]*\n?)*)/gm)].map(m => ({ name: m[1], body: m[2] }));
  const named = prefix => sections.filter(s => s.name.startsWith(prefix)).map(s => ({ name: s.name.slice(prefix.length).replace(/^"|"$/g, '').split('.')[0], enabled: !/^\s*enabled\s*=\s*false/m.test(s.body) }));
  const unique = items => [...new Map(items.map(i => [i.name, i])).values()];
  return {
    plugins: unique(named('plugins.')),
    mcpServers: unique(named('mcp_servers.')).map(m => m.name).sort(),
    skills: countFiles(join(dir, 'skills'), n => n === 'SKILL.md'),
    memory: { globalInstructions: existsSync(join(dir, 'AGENTS.md')), memories: existsSync(join(dir, 'memories_1.sqlite')) },
  };
}

export function readCatalog({ home }) { return { claude: claudeCatalog(home), codex: codexCatalog(home) }; }
