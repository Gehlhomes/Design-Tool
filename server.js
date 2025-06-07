const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');
const os = require('os');

// Allow specifying a custom path for the data file so deployments can
// store it on a persistent volume. Defaults to "data.json" in the
// application directory.
const DATA_FILE = process.env.DATA_FILE || 'data.json';
let data = { experiences: {}, analytics: [] };
if (fs.existsSync(DATA_FILE)) {
  try {
    data = JSON.parse(fs.readFileSync(DATA_FILE));
  } catch (e) {
    console.error('Failed to parse data file:', e);
  }
}

function saveData() {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

function getLocalAddress() {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        return net.address;
      }
    }
  }
  return 'localhost';
}

function sendJson(res, status, obj) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  });
  res.end(JSON.stringify(obj));
}

function parseRequestBody(req, callback) {
  let body = '';
  req.on('data', chunk => (body += chunk));
  req.on('end', () => {
    try {
      callback(body ? JSON.parse(body) : {});
    } catch {
      callback({});
    }
  });
}

const server = http.createServer((req, res) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    });
    res.end();
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === 'GET' && url.pathname === '/server-address') {
    const address = getLocalAddress();
    return sendJson(res, 200, { address, port: PORT });
  }

  if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
    fs.readFile(path.join(__dirname, 'index.html'), (err, content) => {
      if (err) {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Server error');
      } else {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(content);
      }
    });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/experiences') {
    return parseRequestBody(req, body => {
      const id = Date.now().toString();
      const { sections, name } = body;
      data.experiences[id] = { sections, name };
      saveData();
      sendJson(res, 200, { id });
    });
  }

  if (req.method === 'GET' && url.pathname === '/experiences') {
    const exps = Object.entries(data.experiences).map(([id, exp]) => ({
      id,
      ...exp
    }));
    return sendJson(res, 200, exps);
  }

  if (req.method === 'GET' && url.pathname.startsWith('/experiences/')) {
    const id = url.pathname.split('/')[2];
    const exp = data.experiences[id];
    if (exp) {
      sendJson(res, 200, exp);
    } else {
      sendJson(res, 404, { error: 'Not found' });
    }
    return;
  }

  if (req.method === 'PUT' && url.pathname.startsWith('/experiences/')) {
    const id = url.pathname.split('/')[2];
    return parseRequestBody(req, body => {
      if (data.experiences[id]) {
        const { sections, name } = body;
        data.experiences[id] = { sections, name };
        saveData();
        sendJson(res, 200, { success: true });
      } else {
        sendJson(res, 404, { error: 'Not found' });
      }
    });
  }

  if (req.method === 'DELETE' && url.pathname.startsWith('/experiences/')) {
    const id = url.pathname.split('/')[2];
    if (data.experiences[id]) {
      delete data.experiences[id];
      saveData();
      sendJson(res, 200, { success: true });
    } else {
      sendJson(res, 404, { error: 'Not found' });
    }
    return;
  }

  if (req.method === 'POST' && url.pathname === '/analytics') {
    return parseRequestBody(req, body => {
      const record = {
        id: Date.now().toString(),
        email: body.email,
        count: body.count,
        pdfBase64: body.pdfBase64
      };
      data.analytics.push(record);
      saveData();
      sendJson(res, 200, { success: true });
    });
  }

  if (req.method === 'GET' && url.pathname === '/analytics') {
    return sendJson(res, 200, data.analytics);
  }

  sendJson(res, 404, { error: 'Not found' });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
