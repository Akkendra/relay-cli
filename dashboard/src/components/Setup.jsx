import { Dot } from './Seg.jsx';
import { providerName } from '../format.js';

const n = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;
function contents(p) {
  const parts = [p.skills && n(p.skills, 'skill'), p.commands && n(p.commands, 'command'), p.agents && n(p.agents, 'agent'),
    p.hooks?.length && `hooks: ${p.hooks.join(', ')}`, p.mcpServers?.length && n(p.mcpServers.length, 'MCP server')].filter(Boolean);
  return parts.join(' · ') || '—';
}

function Agent({ provider, c }) {
  const rows = provider === 'claude'
    ? [['Skills (yours)', c.skills], ['Agents', c.agents], ['Hooks', c.hooks.join(', ') || '—'], ['MCP servers', c.mcpServers.join(', ') || '—'],
       ['Status line', c.statusLine ? 'on' : 'off'], ['Memory', `${c.memory.globalInstructions ? 'CLAUDE.md · ' : ''}${n(c.memory.projectMemories, 'project note')}`]]
    : [['Skills', c.skills], ['MCP servers', c.mcpServers.join(', ') || '—'], ['Memory', [c.memory.globalInstructions && 'AGENTS.md', c.memory.memories && 'memories on'].filter(Boolean).join(' · ') || '—']];
  return (
    <div className="card">
      <h2><Dot provider={provider} /> {providerName(provider)} setup</h2>
      <dl className="kv">{rows.map(([k, v]) => [<dt key={`${k}t`}>{k}</dt>, <dd key={`${k}d`}>{v}</dd>])}</dl>
      <h2 className="section-title">Plugins ({c.plugins.length})</h2>
      <div className="table-wrap"><table><tbody>
        {c.plugins.map(p => (
          <tr key={p.name}><td>{p.enabled ? <span className="status good">On</span> : <span className="status idle muted">Off</span>}</td>
            <td>{p.name}{p.version ? <span className="muted"> {p.version}</span> : null}</td><td className="muted wrap">{provider === 'claude' ? contents(p) : ''}</td></tr>
        ))}
      </tbody></table></div>
    </div>
  );
}

export function Setup({ catalog }) {
  if (!catalog) return null;
  return <section><h2 className="section-title">Setup</h2><div className="grid tasks"><Agent provider="claude" c={catalog.claude} /><Agent provider="codex" c={catalog.codex} /></div></section>;
}
