const express = require('express');
const fs = require('fs');
const cors = require('cors');

const app = express();
app.use(express.json({ limit: '10mb' }));
app.use(cors());

const DATA_FILE = 'data.json';
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

// Save new experience and return id
app.post('/experiences', (req, res) => {
  const id = Date.now().toString();
  const { sections, name } = req.body;
  data.experiences[id] = { sections, name };
  saveData();
  res.json({ id });
});

// Get experience by id
app.get('/experiences/:id', (req, res) => {
  const exp = data.experiences[req.params.id];
  if (exp) {
    res.json(exp);
  } else {
    res.status(404).json({ error: 'Not found' });
  }
});

// Add analytics record
app.post('/analytics', (req, res) => {
  const record = {
    id: Date.now().toString(),
    email: req.body.email,
    count: req.body.count,
    pdfBase64: req.body.pdfBase64,
  };
  data.analytics.push(record);
  saveData();
  res.json({ success: true });
});

// Fetch analytics records
app.get('/analytics', (req, res) => {
  res.json(data.analytics);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
