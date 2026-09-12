// server.js - IFRC Safekeep Tracking Terminal Backend
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');

const app = express();
app.use(cors({ origin: '*' }));
app.use(express.json());

mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('✅ MongoDB Connected'))
  .catch(err => console.error('❌ DB Error:', err));

// --- Schemas ---
const EventSchema = new mongoose.Schema({
  day: Number, date: String, sector: String, knots: Number,
  seaState: String, title: String, text: String, lat: String, lon: String, status: String
});

const WaybillSchema = new mongoose.Schema({
  waybillId: { type: String, unique: true, required: true }, // Consignment ID
  owner: { type: String, required: true },
  route: { type: String, required: true },
  pinHash: { type: String, required: true },
  events: [EventSchema],
  createdAt: { type: Date, default: Date.now }
});

const AdminSchema = new mongoose.Schema({
  username: { type: String, unique: true, required: true },
  passwordHash: { type: String, required: true }
});

const MessageSchema = new mongoose.Schema({
  consignmentId: String,
  senderName: String,
  senderEmail: String,
  message: String,
  response: String,
  status: { type: String, default: 'Open' },
  date: { type: Date, default: Date.now }
});

const Waybill = mongoose.model('Waybill', WaybillSchema);
const Admin = mongoose.model('Admin', AdminSchema);
const Message = mongoose.model('Message', MessageSchema);

async function seedAdmin() {
  if (await Admin.findOne({ username: 'admin' })) return;
  const hash = await bcrypt.hash('admin123', 10);
  await Admin.create({ username: 'admin', passwordHash: hash });
  console.log('👤 Admin created: admin / admin123');
}
seedAdmin();

const authenticateAdmin = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: 'No token' });
  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.adminId = decoded.id;
    next();
  } catch (err) {
    res.status(401).json({ error: 'Invalid token' });
  }
};

// --- Auth ---
app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body;
  const admin = await Admin.findOne({ username });
  if (!admin) return res.status(401).json({ error: 'Invalid credentials' });
  const match = await bcrypt.compare(password, admin.passwordHash);
  if (!match) return res.status(401).json({ error: 'Invalid credentials' });
  const token = jwt.sign({ id: admin._id }, process.env.JWT_SECRET, { expiresIn: '1d' });
  res.json({ token });
});

// --- Viewer Login ---
app.post('/api/viewer/login', async (req, res) => {
  const { waybill, pin } = req.body;
  const record = await Waybill.findOne({ waybillId: waybill });
  if (!record) return res.status(401).json({ error: 'Invalid Consignment ID' });
  const match = await bcrypt.compare(pin, record.pinHash);
  if (!match) return res.status(401).json({ error: 'Invalid PIN' });
  res.json({ waybillId: record.waybillId, owner: record.owner, route: record.route, events: record.events });
});

// --- Admin Waybill Routes ---
app.get('/api/admin/waybills', authenticateAdmin, async (req, res) => {
  const list = await Waybill.find({}, 'waybillId owner route createdAt');
  res.json(list);
});

app.get('/api/admin/waybills/:id', authenticateAdmin, async (req, res) => {
  const record = await Waybill.findOne({ waybillId: req.params.id });
  if (!record) return res.status(404).json({ error: 'Not found' });
  res.json(record);
});

app.post('/api/admin/waybills', authenticateAdmin, async (req, res) => {
  const { waybillId, owner, route, pin, initialEvent } = req.body;
  if (!waybillId || !owner || !route || !pin) return res.status(400).json({ error: 'Missing required fields' });
  const exists = await Waybill.findOne({ waybillId });
  if (exists) return res.status(400).json({ error: 'Consignment ID already exists' });
  const pinHash = await bcrypt.hash(pin, 10);
  const events = initialEvent ? [initialEvent] : [];
  const newWaybill = await Waybill.create({ waybillId, owner, route, pinHash, events });
  res.status(201).json({ message: 'Created', waybill: newWaybill });
});

app.post('/api/admin/waybills/:id/events', authenticateAdmin, async (req, res) => {
  const record = await Waybill.findOne({ waybillId: req.params.id });
  if (!record) return res.status(404).json({ error: 'Not found' });
  record.events.push(req.body);
  await record.save();
  res.json({ message: 'Event added', events: record.events });
});

app.put('/api/admin/waybills/:id/events', authenticateAdmin, async (req, res) => {
  const record = await Waybill.findOne({ waybillId: req.params.id });
  if (!record) return res.status(404).json({ error: 'Not found' });
  record.events = req.body.events;
  await record.save();
  res.json({ message: 'Events updated', events: record.events });
});

// --- Customer Care Messaging (Email & Live Chat) ---
app.post('/api/customer/message', async (req, res) => {
  const { consignmentId, senderName, senderEmail, message } = req.body;
  const newMsg = await Message.create({ consignmentId, senderName, senderEmail, message });
  
     // Setup Email Transport for Hotmail/Outlook
  const transporter = nodemailer.createTransport({
  
  host: 'smtp-mail.outlook.com',
    port: 587,
    secure: false,
    auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
    tls: { ciphers: 'SSLv3' }
  });});
  
  const mailOptions = {
    from: process.env.EMAIL_USER,
    to: process.env.EMAIL_USER, // Red Cross Safekeep.dpt
    subject: `New Customer Query for Consignment ${consignmentId}`,
    text: `Name: ${senderName}\nEmail: ${senderEmail}\nConsignment: ${consignmentId}\n\nMessage:\n${message}`
  };
  
  try { await transporter.sendMail(mailOptions); } catch (err) { console.log('Email not sent (no SMTP config)', err); }
  
  res.json({ success: true, message: 'Message received' });
});

app.get('/api/admin/messages', authenticateAdmin, async (req, res) => {
  const list = await Message.find().sort({ date: -1 });
  res.json(list);
});

app.post('/api/admin/messages/:id/reply', authenticateAdmin, async (req, res) => {
  const { response } = req.body;
  const msg = await Message.findById(req.params.id);
  if (!msg) return res.status(404).json({ error: 'Not found' });
  msg.response = response;
  msg.status = 'Answered';
  await msg.save();
  res.json({ success: true });
});

app.listen(process.env.PORT, () => console.log(`🚀 Server running on port ${process.env.PORT}`));
