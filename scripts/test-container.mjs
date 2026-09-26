// Runs a disposable container against a local mock API; never uses real credentials.
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
const image = process.argv[2] || 'codex-sn-management:test'
const backendImage = process.env.SN_TEST_BACKEND_IMAGE || 'node:24-alpine'
let container, backend, networkCreated = false
const network = `sn-management-check-${process.pid}`
const docker = (args) => execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
try {
  const rejected = spawnSync('docker', ['run', '--rm', '-e', 'APP_API_2_URL=http://other-api:80', image], { encoding: 'utf8' })
  assert.notEqual(rejected.status, 0)
  assert.match(rejected.stderr, /uses one backend/)
  docker(['network', 'create', network]); networkCreated = true
  const fixture = `let failures=0;require('http').createServer(async(req,res)=>{let body='';for await(const c of req)body+=c;const fail=req.url.includes('/fail');if(fail)failures++;res.writeHead(fail?503:200,{'Content-Type':'application/json'});res.end(JSON.stringify({method:req.method,url:req.url,authorization:req.headers.authorization,body,failures}));}).listen(8080,'0.0.0.0')`
  backend = docker(['run', '-d', '--rm', '--network', network, '--network-alias', 'sn-mock-api', backendImage, 'node', '-e', fixture])
  container = docker(['run', '-d', '--rm', '--network', network, '-p', '127.0.0.1::80', '-e', 'APP_API_1_URL=http://sn-mock-api:8080/business-api', image])
  const mapped = docker(['port', container, '80/tcp'])
  const port = mapped.split(':').at(-1)
  const base = `http://127.0.0.1:${port}`
  for (let attempt = 0; attempt < 30; attempt++) {
    try { if ((await fetch(`${base}/health`)).ok) break } catch {}
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  assert.equal((await (await fetch(`${base}/health`)).json()).plugin, 'sn-management')
  assert.equal((await (await fetch(`${base}/plugin-manifest.json`)).json()).id, 'sn-management')
  assert.match(await (await fetch(`${base}/codes`)).text(), /id="app"/)
  const response = await fetch(`${base}/api/v1/plugin-sn/generate?batch=test`, {
    method: 'POST', headers: { Authorization: 'Bearer test-token', 'Content-Type': 'application/json' }, body: JSON.stringify({ user_id: 9, count: 1 }),
  })
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('cache-control'), 'no-store')
  const proxied = await response.json()
  assert.equal(proxied.url, '/business-api/v1/plugin-sn/generate?batch=test')
  assert.equal(proxied.method, 'POST')
  assert.equal(proxied.authorization, 'Bearer test-token')
  assert.deepEqual(JSON.parse(proxied.body), { user_id: 9, count: 1 })
  const failure = await fetch(`${base}/api/v1/plugin-sn/fail`, { method: 'POST' })
  assert.equal(failure.status, 503)
  const stats = await (await fetch(`${base}/api/stats`)).json()
  assert.equal(stats.failures, 1)
  docker(['exec', container, 'nginx', '-t'])
  console.log('Passed: one-backend guard, Nginx config, health, manifest, SPA route, prefixed API/auth/body/query proxy, no-store, no write retries.')
} catch (error) {
  if (container) console.error(docker(['logs', container]))
  throw error
} finally {
  if (container) docker(['rm', '-f', container])
  if (backend) docker(['rm', '-f', backend])
  if (networkCreated) docker(['network', 'rm', network])
}
