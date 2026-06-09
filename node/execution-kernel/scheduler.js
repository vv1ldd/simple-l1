const { KernelError, FAILURE } = require('./errors');

function topologicalSort(graph) {
  const nodes = graph.nodes || [];
  const edges = graph.edges || [];
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const incoming = new Map(nodes.map((node) => [node.id, 0]));
  const outgoing = new Map(nodes.map((node) => [node.id, []]));

  for (const edge of edges) {
    if (!byId.has(edge.from) || !byId.has(edge.to)) {
      throw new KernelError(FAILURE.TOPOLOGY_ERROR, 'Edge references unknown node', edge);
    }
    incoming.set(edge.to, incoming.get(edge.to) + 1);
    outgoing.get(edge.from).push(edge.to);
  }

  const ready = nodes
    .filter((node) => incoming.get(node.id) === 0)
    .map((node) => node.id)
    .sort();
  const ordered = [];

  while (ready.length > 0) {
    const id = ready.shift();
    ordered.push(byId.get(id));
    for (const target of outgoing.get(id).slice().sort()) {
      incoming.set(target, incoming.get(target) - 1);
      if (incoming.get(target) === 0) {
        ready.push(target);
        ready.sort();
      }
    }
  }

  if (ordered.length !== nodes.length) {
    throw new KernelError(FAILURE.TOPOLOGY_ERROR, 'Cycle detected in SDGA graph');
  }

  return ordered;
}

module.exports = {
  topologicalSort,
};
