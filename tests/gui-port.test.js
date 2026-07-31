const assert = require('assert');
const fs = require('fs').promises;
const os = require('os');
const path = require('path');
const http = require('http');

async function run() {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'kanbango-gui-'));
  process.chdir(tempRoot);

  const guiRegistry = require(path.join(__dirname, '..', 'gui-registry.js'));
  const mcpServer = require(path.join(__dirname, '..', 'mcp-server.js'));

  const portA = guiRegistry.hashCwdToPort(tempRoot);
  const portB = guiRegistry.hashCwdToPort(tempRoot);
  assert.strictEqual(portA, portB, 'hashCwdToPort should be stable for the same cwd');
  assert.ok(portA >= guiRegistry.GUI_PORT_MIN && portA <= guiRegistry.GUI_PORT_MAX);

  const otherPort = guiRegistry.hashCwdToPort(path.join(tempRoot, 'other-project'));
  assert.ok(otherPort >= guiRegistry.GUI_PORT_MIN && otherPort <= guiRegistry.GUI_PORT_MAX);

  delete process.env.KANBANGO_GUI_PORT;
  const preferred = guiRegistry.resolvePreferredGuiPort();
  assert.strictEqual(preferred, guiRegistry.hashCwdToPort(process.cwd()));

  process.env.KANBANGO_GUI_PORT = '5821';
  assert.strictEqual(guiRegistry.resolvePreferredGuiPort(), 5821);
  assert.strictEqual(guiRegistry.resolvePreferredGuiPort(5900), 5900);
  delete process.env.KANBANGO_GUI_PORT;

  const cwdNow = process.cwd();
  const expectedProject = path.basename(cwdNow);
  assert.strictEqual(guiRegistry.projectLabel(cwdNow), expectedProject);

  const written = await guiRegistry.writeGuiPortFile({ port: 5833, pid: process.pid });
  assert.strictEqual(written.port, 5833);
  assert.strictEqual(written.url, 'http://localhost:5833');
  assert.strictEqual(written.project, expectedProject);
  assert.strictEqual(written.cwd, cwdNow);

  const readBack = await guiRegistry.readGuiPortFile();
  assert.strictEqual(readBack.port, 5833);
  assert.strictEqual(readBack.project, expectedProject);

  const discovered = await guiRegistry.discoverRunningGui();
  assert.ok(discovered);
  assert.strictEqual(discovered.port, 5833);
  assert.strictEqual(discovered.pid, process.pid);
  assert.strictEqual(discovered.project, expectedProject);

  await guiRegistry.clearGuiPortFile({ pid: process.pid });
  assert.strictEqual(await guiRegistry.readGuiPortFile(), null);

  const externalStatus = await mcpServer.guiStatus();
  assert.strictEqual(externalStatus.status, 'not_running');

  await guiRegistry.writeGuiPortFile({ port: 5834, pid: process.pid });
  const externalRunning = await mcpServer.guiStatus();
  assert.strictEqual(externalRunning.status, 'external_running');
  assert.strictEqual(externalRunning.owned, false);
  assert.strictEqual(externalRunning.pid, process.pid);

  const refuseStop = await mcpServer.stopGuiServer();
  assert.strictEqual(refuseStop.status, 'external_running');
  assert.strictEqual(refuseStop.owned, false);
  assert.ok(guiRegistry.isPidAlive(process.pid), 'stop must not kill external/self PID');
  assert.ok(await guiRegistry.readGuiPortFile(), 'external port file must remain after refused stop');

  await guiRegistry.clearGuiPortFile({ force: true });

  const started = await mcpServer.startGuiServer();
  assert.strictEqual(started.status, 'started');
  assert.strictEqual(started.owned, true);
  assert.ok(started.port >= 1 && started.port <= 65535);
  assert.ok(started.url.startsWith('http://localhost:'));
  assert.ok(started.pid);
  assert.strictEqual(started.project, expectedProject);
  assert.strictEqual(started.cwd, cwdNow);

  const status = await mcpServer.guiStatus();
  assert.strictEqual(status.status, 'running');
  assert.strictEqual(status.owned, true);
  assert.strictEqual(status.port, started.port);
  assert.strictEqual(status.url, started.url);
  assert.strictEqual(status.project, expectedProject);

  await new Promise((resolve, reject) => {
    http.get(started.url, (res) => {
      assert.strictEqual(res.statusCode, 200);
      let body = '';
      res.setEncoding('utf-8');
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        try {
          assert.ok(body.includes(`<title>${expectedProject} · Kanban</title>`), 'HTML title should include project');
          assert.ok(body.includes(`<h1>${expectedProject}</h1>`), 'HTML h1 should include project');
          resolve();
        } catch (err) {
          reject(err);
        }
      });
    }).on('error', reject);
  });

  const again = await mcpServer.startGuiServer();
  assert.strictEqual(again.status, 'already_running');
  assert.strictEqual(again.owned, true);
  assert.strictEqual(again.port, started.port);
  assert.strictEqual(again.project, expectedProject);

  const stopped = await mcpServer.stopGuiServer();
  assert.strictEqual(stopped.status, 'stopping');
  assert.strictEqual(stopped.owned, true);
  assert.strictEqual(stopped.port, started.port);

  const afterStop = await mcpServer.guiStatus();
  assert.strictEqual(afterStop.status, 'not_running');
  assert.strictEqual(await guiRegistry.readGuiPortFile(), null);

  const detached = await mcpServer.startGuiServer();
  assert.strictEqual(detached.status, 'started');
  const detachedPid = detached.pid;
  const detachedPort = detached.port;

  const portFile = await guiRegistry.readGuiPortFile();
  assert.ok(portFile);
  assert.strictEqual(portFile.pid, detachedPid);

  const childPath = path.join(__dirname, '..', 'mcp-server.js');
  const { spawnSync } = require('child_process');
  const probe = spawnSync(process.execPath, ['-e', `
    process.chdir(${JSON.stringify(tempRoot)});
    const mcp = require(${JSON.stringify(childPath)});
    (async () => {
      const status = await mcp.guiStatus();
      const stop = await mcp.stopGuiServer();
      console.log(JSON.stringify({ status, stop }));
    })().catch((err) => {
      console.error(err);
      process.exit(1);
    });
  `], { encoding: 'utf-8' });

  assert.strictEqual(probe.status, 0, probe.stderr || 'probe failed');
  const probeResult = JSON.parse(probe.stdout.trim().split('\n').filter(Boolean).pop());
  assert.strictEqual(probeResult.status.status, 'external_running');
  assert.strictEqual(probeResult.stop.status, 'external_running');
  assert.ok(guiRegistry.isPidAlive(detachedPid), 'other MCP must not kill this session GUI');
  assert.ok(await guiRegistry.readGuiPortFile(), 'port file must survive foreign stop');

  process.kill(detachedPid, 'SIGTERM');
  const deadline = Date.now() + 2000;
  while (Date.now() < deadline && guiRegistry.isPidAlive(detachedPid)) {
    await new Promise((r) => setTimeout(r, 50));
  }
  await guiRegistry.clearGuiPortFile({ force: true });
  assert.strictEqual(detachedPort, detached.port);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
