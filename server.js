const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');
const os = require('os');
const crypto = require('crypto');
let multer = null;
try {
  multer = require('multer');
} catch (e) {
  console.warn('multer not installed; image uploads disabled');
}
try { require('dotenv').config(); } catch {}
let createClient = null;
try { ({ createClient } = require('@supabase/supabase-js')); } catch {}

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
const supabase = supabaseUrl && supabaseKey && createClient
  ? createClient(supabaseUrl, supabaseKey)
  : null;

const stripeSecret = process.env.STRIPE_SECRET_KEY;
const stripe = stripeSecret ? require('stripe')(stripeSecret) : null;

// Cache static HTML so requests return faster
const homeHtml = fs.readFileSync(path.join(__dirname, 'home.html'));
const appHtml = fs.readFileSync(path.join(__dirname, 'app.html'));

// Image storage setup
let upload = null;
if (multer) {
  const storage = multer.diskStorage({
    destination: (req, file, cb) => {
      const dir = path.join(__dirname, 'uploads/images');
      fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (req, file, cb) => {
      cb(null, Date.now() + '-' + file.originalname);
    }
  });
  upload = multer({ storage });
}

// Allow specifying a custom path for the data file so deployments can
// store it on a persistent volume. If DATA_FILE is not provided, use a
// default location inside the user's home directory so the file isn't
// replaced when the application code is updated.
const DEFAULT_DATA_FILE = path.join(os.homedir(), 'design-tool', 'data.json');
let DATA_FILE = process.env.DATA_FILE
  ? path.resolve(process.env.DATA_FILE)
  : DEFAULT_DATA_FILE;
// Using a data path inside the app directory means the file will be lost on
// deployments that replace the code. Detect this and fall back to the
// persistent default path so experiences survive code updates.
if (DATA_FILE.startsWith(path.resolve(__dirname))) {
  console.warn(
    `DATA_FILE ${DATA_FILE} is inside the application directory; ` +
    `falling back to ${DEFAULT_DATA_FILE} to preserve data across deployments.`
  );
  DATA_FILE = DEFAULT_DATA_FILE;
}
// If a legacy data.json exists in the application directory but the
// persistent file does not yet, migrate the old data to the new location so
// saved experiences survive code updates.
const LEGACY_DATA_FILE = path.join(__dirname, 'data.json');
if (!fs.existsSync(DATA_FILE) && fs.existsSync(LEGACY_DATA_FILE)) {
  try {
    fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
    fs.copyFileSync(LEGACY_DATA_FILE, DATA_FILE);
    console.log(`Migrated data file from ${LEGACY_DATA_FILE} to ${DATA_FILE}`);
  } catch (e) {
    console.error('Failed to migrate legacy data file:', e);
  }
}
let data = { experiences: {}, analytics: [], users: {} };
if (!supabase) {
  console.log('Using local data file at ' + DATA_FILE);
  console.warn('Warning: No Supabase configured. Using local file storage. Ensure persistent volume is set up on Render to avoid data loss.');
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
} else {
  console.log('Using Supabase for storage.');
}

function hashPassword(pass) {
  return crypto.createHash('sha256').update(pass).digest('hex');
}

function ensureDefaultUser() {
  const existing = Object.values(data.users || {}).find(
    u => (u.username || '').toLowerCase() === 'gehlhomes'
  );
  if (!existing) {
    const id = Date.now().toString();
    data.users[id] = {
      username: 'Gehlhomes',
      passwordHash: hashPassword('GEadmin'),
      subscription: 'active'
    };
    saveData();
  }
}

let saving = false;
let pendingSave = false;
ensureDefaultUser();
function saveData() {
  if (supabase) return;
  if (saving) {
    pendingSave = true;
    return;
  }
  saving = true;
  fs.writeFile(DATA_FILE, JSON.stringify(data, null, 2), err => {
    saving = false;
    if (err) console.error('Failed to save data:', err);
    if (pendingSave) {
      pendingSave = false;
      saveData();
    }
  });
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
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
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

function parseRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
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
    // Normalize user id field so the front-end doesn't need to handle
    // different property names.
    return rows.map(r => ({ ...r, userId: r.user_id }));
  }
  return data.analytics
    .filter(a => (a.userId ?? a.user_id) === userId)
    .map(a => ({ ...a, userId: a.userId ?? a.user_id }));
}

async function dbDeleteAnalytics(id) {
  if (supabase) {
    const { error } = await supabase.from('analytics').delete().eq('id', id);
    if (error) throw error;
    return true;
  }
  const idx = data.analytics.findIndex(a => a.id === id);
  if (idx !== -1) {
    data.analytics.splice(idx, 1);
    saveData();
    return true;
  }
  return false;
}

async function uploadImageToSupabase(file) {
  const { data, error } = await supabase.storage
    .from('images') // Assume a public bucket named 'images'
    .upload(`public/${Date.now()}-${file.originalname}`, file.buffer, {
      contentType: file.mimetype
    });
  if (error) throw error;
  const { publicUrl } = supabase.storage.from('images').getPublicUrl(data.path);
  return publicUrl;
}

const server = http.createServer(async (req, res) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
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

  if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/home.html')) {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(homeHtml);
    return;
  }

  if (req.method === 'GET' && url.pathname === '/app') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(appHtml);
    return;
  }

  // Serve uploaded images if local storage
  if (!supabase && req.method === 'GET' && url.pathname.startsWith('/uploads/images/')) {
    const filePath = path.join(__dirname, url.pathname);
    if (fs.existsSync(filePath)) {
      const stat = fs.statSync(filePath);
      res.writeHead(200, {
        'Content-Type': 'image/jpeg', // Adjust based on file type if needed
        'Content-Length': stat.size
      });
      fs.createReadStream(filePath).pipe(res);
    } else {
      res.writeHead(404);
      res.end('Not found');
    }
    return;
  }

  if (req.method === 'POST' && url.pathname === '/upload-image') {
    if (!upload) {
      return sendJson(res, 501, { error: 'Uploads disabled' });
    }
    upload.single('image')(req, res, async (err) => {
      if (err) {
        console.error(err);
        return sendJson(res, 500, { error: 'Upload failed' });
      }
      try {
        let imageUrl;
        if (supabase) {
          imageUrl = await uploadImageToSupabase(req.file);
        } else {
          imageUrl = `/uploads/images/${req.file.filename}`;
        }
        sendJson(res, 200, { url: imageUrl });
      } catch (e) {
        console.error(e);
        sendJson(res, 500, { error: 'Upload failed' });
      }
    });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/signup') {
    return parseRequestBody(req, body => {
      const { username, password } = body;
      if (!username || !password) {
        res.writeHead(400, { 'Content-Type': 'text/plain' });
        return res.end('Missing username or password');
      }
      const lower = username.toLowerCase();
      const exists = Object.entries(data.users).find(
        ([, u]) => (u.username || '').toLowerCase() === lower
      );
      if (exists) {
        res.writeHead(409, { 'Content-Type': 'text/plain' });
        return res.end('Username already exists');
      }
      const id = Date.now().toString();
      data.users[id] = {
        username,
        passwordHash: hashPassword(password),
        subscription: 'none'
      };
      saveData();
      sendJson(res, 200, { userId: id });
    });
  }

  if (req.method === 'POST' && url.pathname === '/login') {
    return parseRequestBody(req, body => {
      const { username, password } = body;
      if (!username || !password) {
        res.writeHead(400, { 'Content-Type': 'text/plain' });
        return res.end('Missing username or password');
      }
      const lower = username.toLowerCase();
      const entry = Object.entries(data.users).find(
        ([id, u]) => (u.username || '').toLowerCase() === lower
      );
      if (entry && entry[1].passwordHash === hashPassword(password)) {
        sendJson(res, 200, { userId: entry[0] });
      } else {
        res.writeHead(401, { 'Content-Type': 'text/plain' });
        res.end('Invalid username or password');
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
      // Store analytics using camelCase when writing to the local JSON
      // file, but keep snake_case when sending to Supabase to match the
      // database column name. This ensures the analytics list works
      // consistently in both modes.
      const baseRecord = {
        id: body.id || Date.now().toString(),
        email: body.email,
        count: body.count,
        pdfBase64: body.pdfBase64
      };
      const record = supabase
        ? { ...baseRecord, user_id: body.userId }
        : { ...baseRecord, userId: body.userId };
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

  if (req.method === 'DELETE' && url.pathname.startsWith('/analytics/')) {
    const id = url.pathname.split('/')[2];
    try {
      const deleted = await dbDeleteAnalytics(id);
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

  if (req.method === 'GET' && url.pathname === '/subscription') {
    const userId = url.searchParams.get('userId');
    const user = data.users[userId];
    const status = user ? user.subscription || 'none' : 'none';
    sendJson(res, 200, { status });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/create-checkout-session') {
    parseRequestBody(req, async (body) => {
      if (!body.userId) {
        res.writeHead(400, { 'Content-Type': 'text/plain' });
        return res.end('Missing userId');
      }
      if (!stripe) {
        res.writeHead(501, { 'Content-Type': 'text/plain' });
        return res.end('Stripe not configured');
      }
      try {
        const session = await stripe.checkout.sessions.create({
          mode: 'subscription',
          payment_method_types: ['card'],
          line_items: [{ price: process.env.STRIPE_PRICE_ID, quantity: 1 }],
          success_url: `${req.headers.origin}/app`,
          cancel_url: `${req.headers.origin}/`,
          client_reference_id: body.userId,
        });
        sendJson(res, 200, { url: session.url });
      } catch (e) {
        console.error(e);
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Failed to create checkout session: ' + e.message);
      }
    });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/webhook') {
    if (!stripe) {
      res.writeHead(501, { 'Content-Type': 'text/plain' });
      return res.end('Stripe not configured');
    }
    try {
      const rawBody = await parseRawBody(req);
      const event = stripe.webhooks.constructEvent(
        rawBody,
        req.headers['stripe-signature'],
        process.env.STRIPE_WEBHOOK_SECRET
      );
      if (event.type === 'checkout.session.completed') {
        const session = event.data.object;
        const userId = session.client_reference_id;
        if (data.users[userId]) {
          data.users[userId].subscription = 'active';
          saveData();
        }
      }
      sendJson(res, 200, { received: true });
    } catch (err) {
      console.error(err);
      sendJson(res, 400, { error: 'Webhook Error' });
    }
    return;
  }

  sendJson(res, 404, { error: 'Not found' });
});

// To handle raw body for webhook, you may need to add a middleware to capture req.rawBody, e.g., using body-parser or custom parser.

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
