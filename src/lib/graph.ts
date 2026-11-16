import type { Achievement } from '../types';
export type GraphNode = { id: string; x: number; y: number };
export function layoutGraph(items: Achievement[]) {
  const byId = new Map(items.map(a => [a.id, a]));
  const children = new Map<string, Achievement[]>();
  for (const a of items) {
    const parent = a.requires && byId.has(a.requires) ? a.requires : '__root__';
    children.set(parent, [...(children.get(parent) ?? []), a]);
  }
  const nodes: GraphNode[] = [], edges: { from: string; to: string }[] = [], seen = new Set<string>();
  let row = 0;
  function visit(id: string, depth: number): GraphNode {
    seen.add(id);
    const next = (children.get(id) ?? []).filter(a => !seen.has(a.id));
    const start = row;
    for (const a of next) { edges.push({ from: id, to: a.id }); visit(a.id, depth + 1); }
    const y = next.length ? (start + row - 1) * 120 / 2 + 24 : row++ * 120 + 24;
    const node = { id, x: depth * 160 + 24, y };
    nodes.push(node); return node;
  }
  visit('__root__', 0);
  // A malformed remote catalog must never hang the client or hide nodes.
  for (const a of items) if (!seen.has(a.id)) { edges.push({ from: '__root__', to: a.id }); visit(a.id, 1); }
  return { nodes, edges, width: Math.max(330, ...nodes.map(n => n.x + 140)), height: Math.max(300, ...nodes.map(n => n.y + 120)) };
}
export function validateCatalog(items: Achievement[]) {
  const byId = new Map<string, Achievement>();
  for (const a of items) {
    if (a.id === '__root__' || !/^[a-zA-Z0-9._-]{1,46}$/.test(a.id)) throw new Error('Недопустимый ID: ' + a.id);
    if (byId.has(a.id)) throw new Error('Повтор ID: ' + a.id);
    if (!Number.isInteger(a.order) || a.order < 0 || !Number.isInteger(a.branch_id)) throw new Error('Проверь номер ветви и порядок: ' + a.id);
    if (!a.title.trim() || a.title.length > 240 || a.description.length > 3000) throw new Error('Проверь название и описание: ' + a.id);
    byId.set(a.id, a);
  }
  for (const a of items) {
    const path = new Set<string>([a.id]); let parent = a.requires;
    while (parent) {
      if (path.has(parent)) throw new Error('Цикл в связях: ' + a.id);
      path.add(parent); const p = byId.get(parent);
      if (!p || p.branch_id !== a.branch_id) throw new Error('Предшественник отсутствует или из другой ветки: ' + a.id);
      if ((a as Achievement & {active?:boolean}).active !== false && (p as Achievement & {active?:boolean}).active === false) throw new Error('Сначала скрой или перепривяжи продолжения: ' + a.id);
      parent = p.requires;
    }
  }
}
