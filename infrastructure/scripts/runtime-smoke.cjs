/* Compiled-runtime smoke test. Uses fresh private state and blocks every outbound service request. */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const root = path.resolve(__dirname, '../..');
const req = createRequire(path.join(root,'apps/api/package.json'));
const state = fs.mkdtempSync(path.join(os.tmpdir(),'trading-runtime-smoke-'));
Object.assign(process.env,{NODE_ENV:'production',STATE_DIRECTORY:state,LIVE_EXECUTION_ENABLED:'false',
  OWNER_USERNAME:'owner',OWNER_PASSWORD:'isolated-smoke-owner-password',
  JWT_SECRET:'isolated-smoke-signature-private-123456789',TOKEN_ENCRYPTION_KEY:'isolated-smoke-encryption-private-123456789'});
delete process.env.VITEST;
delete process.env.DAILY_BOT_STORAGE_PATH;
delete process.env.LIVE_EXECUTION_LEDGER_PATH;
delete process.env.STRATEGIES_STORAGE_PATH;
const nativeFetch = globalThis.fetch;
let allowedOrigin = null, app;
globalThis.fetch = (url,options) => {
  if (allowedOrigin && new URL(String(url)).origin === allowedOrigin) return nativeFetch(url,options);
  return Promise.reject(new Error('Smoke test blocks all external data and broker requests.'));
};
async function run(){
  req('reflect-metadata');
  const {NestFactory}=req('@nestjs/core');
  const {WsAdapter}=req('@nestjs/platform-ws');
  const {AppModule}=req(path.join(root,'apps/api/dist/app.module.js'));
  app=await NestFactory.create(AppModule,{logger:false});
  app.setGlobalPrefix('api/v1');app.useWebSocketAdapter(new WsAdapter(app));
  if (process.argv.includes('--initialization-only')) {
    await app.init();
    const {TradingModeService}=req(path.join(root,'apps/api/dist/trading/trading-mode.service.js'));
    const {RiskService}=req(path.join(root,'apps/api/dist/risk/risk.service.js'));
    assert.equal(app.get(TradingModeService).getSnapshot().label,'TESTING');
    assert.equal(app.get(RiskService).getStatus().state,'DISARMED');
    const workerReq=createRequire(path.join(root,'apps/worker/package.json'));
    const {WorkerService}=workerReq(path.join(root,'apps/worker/dist/worker.service.js'));
    assert.equal(new WorkerService().getStatus().isLeader,false);
    console.log('Compiled API initialization and worker load passed: actual provider graph, private state, exclusive runtime lease, Testing and disarmed defaults.');
    return;
  }
  await app.listen(0,'127.0.0.1');
  allowedOrigin='http://127.0.0.1:'+app.getHttpServer().address().port;
  const base=allowedOrigin+'/api/v1';
  assert.equal((await nativeFetch(base+'/health/live')).status,200);
  assert.equal((await nativeFetch(base+'/orders')).status,401);
  const login=await nativeFetch(base+'/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'owner',password:process.env.OWNER_PASSWORD})});
  assert.equal(login.status,201);
  const {token}=await login.json(),headers={Authorization:'Bearer '+token,'Content-Type':'application/json'};
  const snapshot=await (await nativeFetch(base+'/trading/mode',{headers})).json();
  assert.equal(snapshot.label,'TESTING');assert.equal(snapshot.funds.source,'PAPER_SIMULATION');assert.equal(snapshot.funds.availableCash,10000);
  const risk=await (await nativeFetch(base+'/risk/status',{headers})).json();
  assert.equal(risk.state,'DISARMED');
  const orders=await (await nativeFetch(base+'/orders',{headers})).json();
  assert.deepEqual(orders,[]);
  const report=await (await nativeFetch(base+'/reports/daily',{headers})).json();
  assert.equal(report.realizedNetPnl,0);assert.equal(report.totalTrades,0);
  const live=await nativeFetch(base+'/trading/mode',{method:'POST',headers,body:JSON.stringify({mode:'APPROVAL'})});
  assert.equal(live.status,400);
  const WebSocket=req('ws');
  async function websocket(protocols,expected){
    await new Promise((resolve,reject)=>{
      const ws=new WebSocket(allowedOrigin.replace('http','ws')+'/ws',protocols);
      const timeout=setTimeout(()=>{ws.terminate();reject(new Error('WebSocket smoke timed out'));},2000);
      ws.on('message',message=>{
        if(expected==='connected'){assert.equal(JSON.parse(message.toString()).topic,'system.connected');clearTimeout(timeout);ws.close();resolve();}
      });
      ws.on('close',code=>{
        if(expected==='denied'){clearTimeout(timeout);assert.equal(code,1008);resolve();}
      });
      ws.on('error',reject);
    });
  }
  await websocket(undefined,'denied');await websocket(['owner',token],'connected');
  process.env.TRADING_API_URL=base;
  const workerReq=createRequire(path.join(root,'apps/worker/package.json'));
  const {WorkerService}=workerReq(path.join(root,'apps/worker/dist/worker.service.js'));
  const worker=new WorkerService();await worker.observe();
  assert.equal(worker.getStatus().isLeader,false);assert.equal(worker.getStatus().connected,true);assert.equal(worker.getStatus().tradeMode,'PAPER');
  assert.equal((await nativeFetch(base+'/auth/logout',{method:'POST',headers})).status,201);
  assert.equal((await nativeFetch(base+'/orders',{headers})).status,401);
  console.log('Compiled API and worker smoke passed: owner HTTP/WS auth, Testing funds, empty accounting, disarmed restart, disabled Live gate, observer state.');
}
run().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{
  if(app) await app.close();
  globalThis.fetch=nativeFetch;
  fs.rmSync(state,{recursive:true,force:true});
});
