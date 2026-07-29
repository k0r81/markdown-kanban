const assert = require('assert');
const fs = require('fs').promises;
const os = require('os');
const path = require('path');
const http = require('http');

async function run() {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'kanbango-gui-'));
  process.chdir(tempRoot);

  const kanban = require(path.join(__dirname, '..', 'kanban.js'));
  const mcpServer = require(path.join(__dirname, '..', 'mcp-server.js'));

  const portA = kanban.hashCwdToPort(tempRoot);
  const portB = kanban.hashCwdToPort(tempRoot);
  assert.strictEqual(portA, portB, 'hashCwdToPort should be stable for the same cwd');
  assert.ok(portA >= kanban.GUI_PORT_MIN && portA <= kanban.GUI_PORT_MAX);

  const otherPort = kanban.hashCwdToPort(path.join(tempRoot, 'other-project'));
  // Different paths usually differ; if hash collides, still valid ports.
  assert.ok(otherPort >= kanban.GUI_PORT_MIN && otherPort <= kanban.GUI_PORT_MAX);

  delete process.env.KANBANGO_GUI_PORT;
  const preferred = kanban.resolvePreferredGuiPort();
  assert.strictEqual(preferred, kanban.hashCwdToPort(process.cwd()));

  process.env.KANBANGO_GUI_PORT = '5821';
  assert.strictEqual(kanban.resolvePreferredGuiPort(), 5821);
  assert.strictEqual(kanban.resolvePreferredGuiPort(5900), 5900);
  delete process.env.KANBANGO_GUI_PORT;

  const written = await kanban.writeGuiPortFile({ port: 5833, pid: process.pid });
  assert.strictEqual(written.port, 5833);
  assert.strictEqual(written.url, 'http://localhost:5833');

  const readBack = await kanban.readGuiPortFile();
  assert.strictEqual(readBack.port, 5833);

  const discovered = await kanban.discoverRunningGui();
  assert.ok(discovered);
  assert.strictEqual(discovered.port, 5833);
  assert.strictEqual(discovered.pid, process.pid);

  await kanban.clearGuiPortFile({ pid: process.pid });
  assert.strictEqual(await kanban.readGuiPortFile(), null);

  const started = await mcpServer.startGuiServer();
  assert.strictEqual(started.status, 'started');
  assert.ok(started.port >= 1 && started.port <= 65535);
  assert.ok(started.url.startsWith('http://localhost:'));
  assert.ok(started.pid);

  const status = await mcpServer.guiStatus();
  assert.strictEqual(status.status, 'running');
  assert.strictEqual(status.port, started.port);
  assert.strictEqual(status.url, started.url);

  await new Promise((resolve, reject) => {
    http.get(started.url, (res) => {
      assert.strictEqual(res.statusCode, 200);
      res.resume();
      res.on('end', resolve);
    }).on('error', reject);
  });

  const again = await mcpServer.startGuiServer();
  assert.strictEqual(again.status, 'already_running');
  assert.strictEqual(again.port, started.port);

  const stopped = await mcpServer.stopGuiServer();
  assert.strictEqual(stopped.status, 'stopping');
  assert.strictEqual(stopped.port, started.port);

  const afterStop = await mcpServer.guiStatus();
  assert.strictEqual(afterStop.status, 'not_running');
  assert.strictEqual(await kanban.readGuiPortFile(), null);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
