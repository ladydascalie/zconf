import assert from "node:assert/strict";
import http from "node:http";
import { type AddressInfo } from "node:net";
import { after, before, test } from "node:test";
import { httpOk, tcpConnect } from "../probes.ts";

let server: http.Server;
let port: number;

before(async () => {
  server = http.createServer((_req, res) => {
    res.writeHead(200);
    res.end("ok");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  port = (server.address() as AddressInfo).port;
});

after(() => {
  server.close();
});

test("tcpConnect true for a listening port", async () => {
  assert.equal(await tcpConnect(port), true);
});

test("tcpConnect false for a closed port", async () => {
  assert.equal(await tcpConnect(1), false);
});

test("httpOk true for 200", async () => {
  assert.equal(await httpOk(`http://127.0.0.1:${port}/`), true);
});

test("httpOk false for a refused connection", async () => {
  assert.equal(await httpOk("http://127.0.0.1:1/"), false);
});
