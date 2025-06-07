const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');
const os = require('os');
const crypto = require('crypto');
try { require('dotenv').config(); } catch {}
let createClient = null;
try { ({ createClient } = require('@supabase/supabase-js')); } catch {}

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
const supabase = supabaseUrl && supabaseKey && createClient
  ? createClient(supabaseUrl, supabaseKey)
  : null;

// Allow specifying a custom path for the data file so deployments can
// store it on a persistent volume. If DATA_FILE is not provided, use a
// default location inside the user's home directory so the file isn't
// replaced when the application code is updated.
const DEFAULT_DATA_FILE = path.join(os.homedir(), 'design-tool', 'data.json');
const DATA_FILE = process.env.DATA_FILE || DEFAULT_DATA_FILE;
let data = { experiences: {}, analytics: [], users: {} };
if (!supabase) {
  try {
    fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  } catch (e) {
    console.error('Failed to create data directory:', e);
  }
  if (fs.existsSync(DATA_FILE)) {
    try {
      data = JSON.parse(fs.readFileSync(DATA_FILE));
    } catch (e) {
      console.error('Failed to parse data file:', e);
    }
  } else {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
  }
}

function hashPassword(pass) {
  return crypto.createHash('sha256').update(pass).digest('hex');
}

function ensureDefaultUser() {
  const existing = Object.values(data.users || {}).find(u => u.username === 'gehlhomes');
  if (!existing) {
    const id = Date.now().toString();
    data.users[id] = { username: 'gehlhomes', passwordHash: hashPassword('GEadmin') };
    saveData();
  }
}

ensureDefaultUser();

function saveData() {
  if (!supabase) {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
  }
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

async function dbInsertExperience(userId, sections, name) {
  if (supabase) {
    const { data: rows, error } = await supabase
      .from('experiences')
      .insert({ user_id: userId, sections, name })
      .select('id')
      .single();
    if (error) throw error;
    return rows.id;
  }
  const id = Date.now().toString();
  data.experiences[id] = { sections, name, userId };
  saveData();
  return id;
}

async function dbListExperiences(userId) {
  if (supabase) {
    const { data: rows, error } = await supabase
      .from('experiences')
      .select('id,name,sections')
      .eq('user_id', userId);
    if (error) throw error;
    return rows;
  }
  return Object.entries(data.experiences)
    .filter(([_, exp]) => exp.userId === userId)
    .map(([id, exp]) => ({ id, name: exp.name, sections: exp.sections }));
}

async function dbGetExperience(id) {
  if (supabase) {
    const { data: row, error } = await supabase
      .from('experiences')
      .select('id,name,sections,user_id')
      .eq('id', id)
      .single();
    if (error) return null;
    // Normalize the user id field so the client code doesn't need to handle
    // different property names depending on whether Supabase is used.
    return {
      id: row.id,
      name: row.name,
      sections: row.sections,
      userId: row.user_id
    };
  }
  const exp = data.experiences[id];
  return exp
    ? { id, name: exp.name, sections: exp.sections, userId: exp.userId }
    : null;
}

async function dbUpdateExperience(id, sections, name) {
  if (supabase) {
    const { error } = await supabase
      .from('experiences')
      .update({ sections, name })
      .eq('id', id);
    if (error) throw error;
    return true;
  }
  if (data.experiences[id]) {
    data.experiences[id] = { sections, name, userId: data.experiences[id].userId };
    saveData();
    return true;
  }
  return false;
}

async function dbDeleteExperience(id) {
  if (supabase) {
    const { error } = await supabase.from('experiences').delete().eq('id', id);
    if (error) throw error;
    return true;
  }
  if (data.experiences[id]) {
    delete data.experiences[id];
    saveData();
    return true;
  }
  return false;
}

async function dbInsertAnalytics(record) {
  if (supabase) {
    const { error } = await supabase.from('analytics').insert(record);
    if (error) throw error;
    return true;
  }
  data.analytics.push(record);
  saveData();
  return true;
}

async function dbListAnalytics(userId) {
  if (supabase) {
    const { data: rows, error } = await supabase
      .from('analytics')
      .select()
      .eq('user_id', userId);
    if (error) throw error;
    return rows;
  }
  return data.analytics.filter(a => a.userId === userId);
}

const server = http.createServer(async (req, res) => {
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

  if (req.method === 'POST' && url.pathname === '/signup') {
    return parseRequestBody(req, body => {
      const { username, password } = body;
      if (!username || !password) return sendJson(res, 400, { error: 'missing' });
      const exists = Object.entries(data.users).find(([id, u]) => u.username === username);
      if (exists) return sendJson(res, 409, { error: 'exists' });
      const id = Date.now().toString();
      data.users[id] = { username, passwordHash: hashPassword(password) };
      saveData();
      sendJson(res, 200, { userId: id });
    });
  }

  if (req.method === 'POST' && url.pathname === '/login') {
    return parseRequestBody(req, body => {
      const { username, password } = body;
      const entry = Object.entries(data.users).find(([id, u]) => u.username === username);
      if (entry && entry[1].passwordHash === hashPassword(password)) {
        sendJson(res, 200, { userId: entry[0] });
      } else {
        sendJson(res, 401, { error: 'invalid' });
      }
    });
  }

  if (req.method === 'POST' && url.pathname === '/experiences') {
    return parseRequestBody(req, async body => {
      try {
        const id = await dbInsertExperience(body.userId, body.sections, body.name);
        sendJson(res, 200, { id });
      } catch (e) {
        console.error(e);
        sendJson(res, 500, { error: 'server' });
      }
    });
  }

  if (req.method === 'GET' && url.pathname === '/experiences') {
    const userId = url.searchParams.get('userId');
    try {
      const exps = await dbListExperiences(userId);
      return sendJson(res, 200, exps);
    } catch (e) {
      console.error(e);
      return sendJson(res, 500, { error: 'server' });
    }
  }

  if (req.method === 'GET' && url.pathname.startsWith('/experiences/')) {
    const id = url.pathname.split('/')[2];
    try {
      const exp = await dbGetExperience(id);
      if (exp) {
        sendJson(res, 200, exp);
      } else {
        sendJson(res, 404, { error: 'Not found' });
      }
    } catch (e) {
      console.error(e);
      sendJson(res, 500, { error: 'server' });
    }
    return;
  }

  if (req.method === 'PUT' && url.pathname.startsWith('/experiences/')) {
    const id = url.pathname.split('/')[2];
    return parseRequestBody(req, async body => {
      try {
        const updated = await dbUpdateExperience(id, body.sections, body.name);
        if (updated) {
          sendJson(res, 200, { success: true });
        } else {
          sendJson(res, 404, { error: 'Not found' });
        }
      } catch (e) {
        console.error(e);
        sendJson(res, 500, { error: 'server' });
      }
    });
  }

  if (req.method === 'DELETE' && url.pathname.startsWith('/experiences/')) {
    const id = url.pathname.split('/')[2];
    try {
      const deleted = await dbDeleteExperience(id);
      if (deleted) {
        sendJson(res, 200, { success: true });
      } else {
        sendJson(res, 404, { error: 'Not found' });
      }
    } catch (e) {
      console.error(e);
      sendJson(res, 500, { error: 'server' });
    }
    return;
  }

  if (req.method === 'POST' && url.pathname === '/analytics') {
    return parseRequestBody(req, async body => {
      const record = {
        id: Date.now().toString(),
        email: body.email,
        count: body.count,
        pdfBase64: body.pdfBase64,
        user_id: body.userId
      };
      try {
        await dbInsertAnalytics(record);
        sendJson(res, 200, { success: true });
      } catch (e) {
        console.error(e);
        sendJson(res, 500, { error: 'server' });
      }
    });
  }

  if (req.method === 'GET' && url.pathname === '/analytics') {
    const userId = url.searchParams.get('userId');
    try {
      const rows = await dbListAnalytics(userId);
      return sendJson(res, 200, rows);
    } catch (e) {
      console.error(e);
      return sendJson(res, 500, { error: 'server' });
    }
  }

  sendJson(res, 404, { error: 'Not found' });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
