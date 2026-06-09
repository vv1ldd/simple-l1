const { ExecutionContext } = require('./context');
const { dispatch } = require('./operations');
const { emitResultEnvelope } = require('./result-emitter');
const { topologicalSort } = require('./scheduler');
const { verifyArtifact } = require('./verifier');

function execute(sdga) {
  const identity = verifyArtifact(sdga);
  const context = new ExecutionContext(identity);
  const orderedNodes = topologicalSort(sdga.graph);

  for (const node of orderedNodes) {
    const { outputRef, output } = dispatch(node);
    context.recordNodeResult(node, 'completed', outputRef, output);
  }

  return emitResultEnvelope({
    context,
  });
}

module.exports = {
  execute,
};
