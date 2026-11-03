// The probe's web service: serves its Node runtime on 0.0.0.0:8099, which
// the probe page (and a phone on the LAN) can read.
var http = require('http');
var server = null;

module.exports.onStart = function () {
  server = http.createServer(function (req, res) {
    res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
    res.end(JSON.stringify({ node: process.version, arch: process.arch, from: req.socket.remoteAddress }));
  });
  server.listen(8099, '0.0.0.0');
};

module.exports.onRequest = function () {};

module.exports.onExit = function () {
  if (server) server.close();
};
