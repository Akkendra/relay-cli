import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readCatalog } from '../src/catalog.mjs';

test('the catalog lists plugins, skills, hooks, and MCP server names without any settings values', t => {
  const home = mkdtempSync(join(tmpdir(), 'relay-catalog-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const w = (path, text) => { mkdirSync(join(home, path, '..'), { recursive: true }); writeFileSync(join(home, path), text); };
  const plugin = join(home, 'plugins', 'tidy');
  w('plugins/tidy/.claude-plugin/plugin.json', JSON.stringify({ hooks: ['./hooks/h.json'] }));
  w('plugins/tidy/hooks/h.json', JSON.stringify({ hooks: { SessionStart: [] } }));
  w('plugins/tidy/skills/a/SKILL.md', 'x'); w('plugins/tidy/skills/group/b/SKILL.md', 'x'); w('plugins/tidy/commands/go.md', 'x');
  w('.claude/plugins/installed_plugins.json', JSON.stringify({ plugins: { 'tidy@market': [{ installPath: plugin, version: '1.2.0' }] } }));
  w('.claude/settings.json', JSON.stringify({ enabledPlugins: { 'tidy@market': true }, hooks: { Stop: [] }, statusLine: { command: 'x' } }));
  w('.claude.json', JSON.stringify({ mcpServers: { github: { env: { TOKEN: 'super-secret-value' } } } }));
  w('.claude/skills/mine/SKILL.md', 'x'); w('.claude/projects/p/memory/note.md', 'x'); w('.claude/projects/p/memory/MEMORY.md', 'x');
  w('.codex/config.toml', '[plugins."docs@openai"]\nenabled = true\n\n[plugins."old@openai"]\nenabled = false\n\n[mcp_servers.figma]\ncommand = "x"\n[mcp_servers.figma.env]\nKEY = "nope"\n');
  const c = readCatalog({ home });
  assert.deepEqual(c.claude.plugins, [{ name: 'tidy@market', enabled: true, version: '1.2.0', skills: 2, skillNames: ['a', 'b'], commands: 1, agents: 0, hooks: ['SessionStart'], mcpServers: [] }]);
  assert.deepEqual([c.claude.skills, c.claude.hooks, c.claude.mcpServers, c.claude.statusLine, c.claude.memory.projectMemories], [1, ['Stop'], ['github'], true, 1]);
  assert.deepEqual(c.codex.plugins, [{ name: 'docs@openai', enabled: true }, { name: 'old@openai', enabled: false }]);
  assert.deepEqual(c.codex.mcpServers, ['figma']);
  assert.doesNotMatch(JSON.stringify(c), /super-secret-value|nope/);
});
