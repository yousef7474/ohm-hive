const express = require('express');
const initSqlJs = require('sql.js');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const PDFDocument = require('pdfkit');
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');
const QRCode = require('qrcode');

const app = express();
const PORT = process.env.PORT || 3000;

// Admin credentials
const ADMIN_USERNAME = 'Yusuf7474';
const ADMIN_PASSWORD = 'Khh@8956';

// Telegram Bot Configuration (set these environment variables or edit directly)
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '8304455769:AAE4ctRVPCT7PMRNq4BDtyJ_N83tu_xjUbc';
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || '784662223';

// Function to send Telegram notification
async function sendTelegramNotification(order, serviceDetails) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    console.log('Telegram not configured - skipping notification');
    return;
  }

  const serviceLabels = {
    'course-project': 'Course Project',
    'senior-project': 'Senior Project',
    'consulting': 'Consulting',
    'supervision': 'Senior Project Follow-up',
    '3d-modeling': '3D Modeling',
    '3d-printing': '3D Printing',
    'homework': 'Homework for Courses'
  };

  const message = `
🐝 *NEW ORDER RECEIVED* 🐝

📋 *Order Number:* \`${order.orderNumber}\`

👤 *Customer Information:*
• Name: ${order.firstName} ${order.lastName}
• Phone: ${order.phone}
• Email: ${order.email}

🔧 *Service:* ${serviceLabels[order.serviceType] || order.serviceType}

💰 *Estimated Cost:* ${order.totalCost ? order.totalCost + ' SAR' : 'TBD'}

📅 *Date:* ${new Date().toLocaleString('en-US', { timeZone: 'Asia/Riyadh' })}

🔗 [View in Admin Panel](${process.env.APP_URL || 'http://localhost:3000'}/admin)
  `.trim();

  try {
    const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: TELEGRAM_CHAT_ID,
        text: message,
        parse_mode: 'Markdown'
      })
    });
    const result = await response.json();
    if (result.ok) {
      console.log('Telegram notification sent successfully');
    } else {
      console.error('Telegram error:', result.description);
    }
  } catch (error) {
    console.error('Failed to send Telegram notification:', error.message);
  }
}

// Session tokens storage (in-memory, resets on server restart)
const activeSessions = new Map();

let db;
// Use persistent volume path if available (for Railway), otherwise use local path
const DATA_DIR = process.env.DATA_DIR || __dirname;
const DB_PATH = path.join(DATA_DIR, 'ohm-hive.db');
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

// Initialize database
async function initDatabase() {
  const SQL = await initSqlJs();

  // Load existing database or create new one
  if (fs.existsSync(DB_PATH)) {
    const fileBuffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(fileBuffer);
  } else {
    db = new SQL.Database();
  }

  // Create tables
  db.run(`
    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_number TEXT UNIQUE NOT NULL,
      first_name TEXT NOT NULL,
      last_name TEXT NOT NULL,
      phone TEXT NOT NULL,
      email TEXT NOT NULL,
      service_type TEXT NOT NULL,
      service_details TEXT NOT NULL,
      calculated_costs TEXT NOT NULL,
      total_cost REAL,
      status TEXT DEFAULT 'pending',
      signature TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS uploaded_files (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER,
      filename TEXT NOT NULL,
      original_name TEXT NOT NULL,
      file_path TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (order_id) REFERENCES orders(id)
    )
  `);

  saveDatabase();
  console.log('Database initialized');
}

// Save database to file
function saveDatabase() {
  const data = db.export();
  const buffer = Buffer.from(data);
  fs.writeFileSync(DB_PATH, buffer);
}

// Middleware
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static('public'));
app.use('/translations', express.static('translations'));

// File upload configuration
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    if (!fs.existsSync(UPLOADS_DIR)) {
      fs.mkdirSync(UPLOADS_DIR, { recursive: true });
    }
    cb(null, UPLOADS_DIR);
  },
  filename: (req, file, cb) => {
    const uniqueName = `${Date.now()}-${uuidv4()}${path.extname(file.originalname)}`;
    cb(null, uniqueName);
  }
});

const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['.stl', '.3mf', '.pdf', '.doc', '.docx', '.png', '.jpg', '.jpeg'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowedTypes.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type'), false);
    }
  },
  limits: { fileSize: 50 * 1024 * 1024 } // 50MB limit
});

// Generate unique order number
function generateOrderNumber() {
  const date = new Date();
  const year = date.getFullYear().toString().slice(-2);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
  return `OH-${year}${month}${day}-${random}`;
}

// Helper to get all results as array of objects
function getAll(query, params = []) {
  const stmt = db.prepare(query);
  stmt.bind(params);
  const results = [];
  while (stmt.step()) {
    const row = stmt.getAsObject();
    results.push(row);
  }
  stmt.free();
  return results;
}

// Helper to get single result
function getOne(query, params = []) {
  const results = getAll(query, params);
  return results.length > 0 ? results[0] : null;
}

// Authentication middleware
function requireAuth(req, res, next) {
  const token = req.headers['x-auth-token'];
  if (token && activeSessions.has(token)) {
    const session = activeSessions.get(token);
    // Check if session is still valid (24 hours)
    if (Date.now() - session.createdAt < 24 * 60 * 60 * 1000) {
      return next();
    } else {
      activeSessions.delete(token);
    }
  }
  res.status(401).json({ error: 'Unauthorized' });
}

// Routes

// Serve main page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Serve admin page
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'admin.html'));
});

// API: Admin login
app.post('/api/admin/login', (req, res) => {
  const { username, password } = req.body;

  if (username === ADMIN_USERNAME && password === ADMIN_PASSWORD) {
    const token = crypto.randomBytes(32).toString('hex');
    activeSessions.set(token, {
      username,
      createdAt: Date.now()
    });
    res.json({ success: true, token });
  } else {
    res.status(401).json({ success: false, error: 'Invalid credentials' });
  }
});

// API: Admin logout
app.post('/api/admin/logout', (req, res) => {
  const token = req.headers['x-auth-token'];
  if (token) {
    activeSessions.delete(token);
  }
  res.json({ success: true });
});

// API: Verify token
app.get('/api/admin/verify', (req, res) => {
  const token = req.headers['x-auth-token'];
  if (token && activeSessions.has(token)) {
    const session = activeSessions.get(token);
    if (Date.now() - session.createdAt < 24 * 60 * 60 * 1000) {
      return res.json({ valid: true, username: session.username });
    }
  }
  res.json({ valid: false });
});

// API: Submit order
app.post('/api/orders', upload.array('files', 5), (req, res) => {
  try {
    const {
      firstName,
      lastName,
      phone,
      email,
      serviceType,
      serviceDetails,
      calculatedCosts,
      totalCost,
      signature
    } = req.body;

    const orderNumber = generateOrderNumber();

    db.run(`
      INSERT INTO orders (order_number, first_name, last_name, phone, email, service_type, service_details, calculated_costs, total_cost, signature)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      orderNumber,
      firstName,
      lastName,
      phone,
      email,
      serviceType,
      serviceDetails,
      calculatedCosts,
      totalCost || null,
      signature
    ]);

    const orderId = db.exec("SELECT last_insert_rowid()")[0].values[0][0];

    // Save uploaded files
    if (req.files && req.files.length > 0) {
      for (const file of req.files) {
        db.run(`
          INSERT INTO uploaded_files (order_id, filename, original_name, file_path)
          VALUES (?, ?, ?, ?)
        `, [orderId, file.filename, file.originalname, file.path]);
      }
    }

    saveDatabase();

    // Send Telegram notification (async, don't wait)
    sendTelegramNotification({
      orderNumber,
      firstName,
      lastName,
      phone,
      email,
      serviceType,
      totalCost
    }).catch(err => console.error('Telegram notification error:', err));

    res.json({
      success: true,
      orderNumber,
      orderId
    });
  } catch (error) {
    console.error('Error creating order:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// API: Get all orders (for admin - protected)
app.get('/api/orders', requireAuth, (req, res) => {
  try {
    const orders = getAll('SELECT * FROM orders ORDER BY created_at DESC');

    // Get files for each order
    const ordersWithFiles = orders.map(order => ({
      ...order,
      files: getAll('SELECT * FROM uploaded_files WHERE order_id = ?', [order.id]),
      service_details: JSON.parse(order.service_details || '{}'),
      calculated_costs: JSON.parse(order.calculated_costs || '{}')
    }));

    res.json(ordersWithFiles);
  } catch (error) {
    console.error('Error fetching orders:', error);
    res.status(500).json({ error: error.message });
  }
});

// API: Get single order
app.get('/api/orders/:orderNumber', (req, res) => {
  try {
    const order = getOne('SELECT * FROM orders WHERE order_number = ?', [req.params.orderNumber]);

    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    const files = getAll('SELECT * FROM uploaded_files WHERE order_id = ?', [order.id]);

    res.json({
      ...order,
      files,
      service_details: JSON.parse(order.service_details || '{}'),
      calculated_costs: JSON.parse(order.calculated_costs || '{}')
    });
  } catch (error) {
    console.error('Error fetching order:', error);
    res.status(500).json({ error: error.message });
  }
});

// API: Update order status and cost (protected)
app.patch('/api/orders/:id', requireAuth, (req, res) => {
  try {
    const { status, totalCost, calculatedCosts } = req.body;

    if (status) {
      db.run('UPDATE orders SET status = ?, updated_at = datetime("now") WHERE id = ?', [status, req.params.id]);
    }
    if (totalCost !== undefined) {
      db.run('UPDATE orders SET total_cost = ?, updated_at = datetime("now") WHERE id = ?', [totalCost, req.params.id]);
    }
    if (calculatedCosts) {
      db.run('UPDATE orders SET calculated_costs = ?, updated_at = datetime("now") WHERE id = ?', [JSON.stringify(calculatedCosts), req.params.id]);
    }

    saveDatabase();
    res.json({ success: true });
  } catch (error) {
    console.error('Error updating order:', error);
    res.status(500).json({ error: error.message });
  }
});

// API: Delete order (protected)
app.delete('/api/orders/:id', requireAuth, (req, res) => {
  try {
    // Delete associated files
    const files = getAll('SELECT * FROM uploaded_files WHERE order_id = ?', [req.params.id]);
    for (const file of files) {
      if (fs.existsSync(file.file_path)) {
        fs.unlinkSync(file.file_path);
      }
    }
    db.run('DELETE FROM uploaded_files WHERE order_id = ?', [req.params.id]);
    db.run('DELETE FROM orders WHERE id = ?', [req.params.id]);
    saveDatabase();
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting order:', error);
    res.status(500).json({ error: error.message });
  }
});

// API: Generate PDF receipt (Enhanced with QR code, logo, and bilingual support)
app.get('/api/orders/:orderNumber/pdf', async (req, res) => {
  try {
    const order = getOne('SELECT * FROM orders WHERE order_number = ?', [req.params.orderNumber]);
    const lang = req.query.lang || 'en';
    const isArabic = lang === 'ar';

    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    const serviceDetails = JSON.parse(order.service_details || '{}');
    const calculatedCosts = JSON.parse(order.calculated_costs || '{}');

    // Translations
    const t = {
      en: {
        tagline: 'Where Ideas Buzz to Life',
        contact: 'WhatsApp: 0536113736 | Engineering Services for Students',
        receipt: 'ORDER RECEIPT',
        orderNumber: 'ORDER NUMBER',
        dateStatus: 'DATE / STATUS',
        customerInfo: 'CUSTOMER INFORMATION',
        name: 'Name:',
        phone: 'Phone:',
        email: 'Email:',
        serviceDetails: 'SERVICE DETAILS',
        serviceType: 'Service Type:',
        costBreakdown: 'COST BREAKDOWN',
        total: 'TOTAL:',
        tbd: 'To be determined later by engineer',
        keyTerms: 'KEY TERMS:',
        term1: '- Payment: 50% before start, 50% upon completion',
        term2: '- Components cost not included in service fee',
        term3: '- Late delivery: 200 SAR deduction per day',
        term4: '- One free adjustment included',
        signature: 'CUSTOMER SIGNATURE:',
        footer1: 'This is an electronically generated receipt. By submitting this order, the customer has agreed to all Terms and Conditions.',
        footer2: 'Generated on: ',
        services: {
          'course-project': 'Course Project',
          'senior-project': 'Senior Project',
          'consulting': 'Consulting',
          'supervision': 'Senior Project Follow-up',
          '3d-modeling': '3D Modeling',
          '3d-printing': '3D Printing',
          'homework': 'Homework for Courses'
        },
        statuses: { pending: 'PENDING', confirmed: 'CONFIRMED', 'in-progress': 'IN PROGRESS', completed: 'COMPLETED', cancelled: 'CANCELLED' }
      },
      ar: {
        tagline: 'حيث تنبض الأفكار بالحياة',
        contact: 'واتساب: 0536113736 | خدمات هندسية للطلاب',
        receipt: 'إيصال الطلب',
        orderNumber: 'رقم الطلب',
        dateStatus: 'التاريخ / الحالة',
        customerInfo: 'معلومات العميل',
        name: 'الاسم:',
        phone: 'الهاتف:',
        email: 'البريد:',
        serviceDetails: 'تفاصيل الخدمة',
        serviceType: 'نوع الخدمة:',
        costBreakdown: 'تفاصيل التكلفة',
        total: 'الإجمالي:',
        tbd: 'سيتم تحديدها لاحقاً',
        keyTerms: 'الشروط الأساسية:',
        term1: '- الدفع: 50% قبل البدء، 50% عند الاستلام',
        term2: '- تكلفة المكونات غير مشمولة',
        term3: '- التأخير: تعويض 200 ريال لكل يوم',
        term4: '- تعديل واحد مجاني مشمول',
        signature: 'توقيع العميل:',
        footer1: 'إيصال إلكتروني. بتقديم الطلب وافق العميل على الشروط والأحكام.',
        footer2: 'تاريخ الإصدار: ',
        services: {
          'course-project': 'مشروع مقرر',
          'senior-project': 'مشروع تخرج',
          'consulting': 'استشارات',
          'supervision': 'متابعة مشاريع التخرج',
          '3d-modeling': 'تصميم ثلاثي الأبعاد',
          '3d-printing': 'طباعة ثلاثية الأبعاد',
          'homework': 'واجبات المقررات'
        },
        statuses: { pending: 'قيد الانتظار', confirmed: 'مؤكد', 'in-progress': 'قيد التنفيذ', completed: 'مكتمل', cancelled: 'ملغي' }
      }
    };
    const tr = t[lang] || t.en;

    // Generate QR code with order info
    const qrData = JSON.stringify({
      orderNumber: order.order_number,
      customer: order.first_name + ' ' + order.last_name,
      service: order.service_type,
      date: order.created_at
    });
    const qrCodeDataUrl = await QRCode.toDataURL(qrData, { width: 100, margin: 1 });

    const doc = new PDFDocument({ margin: 50, size: 'A4' });

    // Register Arabic fonts
    const amiriRegular = path.join(__dirname, 'fonts', 'Amiri-Regular.ttf');
    const amiriBold = path.join(__dirname, 'fonts', 'Amiri-Bold.ttf');
    if (fs.existsSync(amiriRegular)) {
      doc.registerFont('Amiri', amiriRegular);
    }
    if (fs.existsSync(amiriBold)) {
      doc.registerFont('Amiri-Bold', amiriBold);
    }

    // Font helpers
    const fontRegular = isArabic ? 'Amiri' : 'Helvetica';
    const fontBold = isArabic ? 'Amiri-Bold' : 'Helvetica-Bold';
    const textAlign = isArabic ? 'right' : 'left';

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=OhmHive-${order.order_number}-${lang}.pdf`);

    doc.pipe(res);

    // Colors
    const honeyGold = '#F5A623';
    const darkCharcoal = '#1A1A2E';
    const electricBlue = '#2D9CDB';

    // Header background
    doc.rect(0, 0, 612, 120).fill(darkCharcoal);

    // Logo (if exists)
    const logoPath = path.join(__dirname, 'public', 'images', 'logo.png');
    if (fs.existsSync(logoPath)) {
      try {
        doc.image(logoPath, isArabic ? 502 : 50, 25, { width: 60 });
      } catch (e) {}
    }

    // Header text
    const headerX = isArabic ? 50 : 120;
    const headerWidth = isArabic ? 440 : 350;
    doc.fillColor('#FFFFFF').fontSize(28).font(fontBold).text('OHM HIVE', headerX, 30, { align: textAlign, width: headerWidth });
    doc.fillColor(honeyGold).fontSize(12).font(fontRegular).text(tr.tagline, headerX, 65, { align: textAlign, width: headerWidth });
    doc.fillColor('#AAAAAA').fontSize(9).text(tr.contact, headerX, 85, { align: textAlign, width: headerWidth });

    // QR Code in header
    try {
      doc.image(qrCodeDataUrl, isArabic ? 50 : 480, 20, { width: 80 });
    } catch (e) {}

    // Receipt title bar
    doc.rect(0, 120, 612, 35).fill(honeyGold);
    doc.fillColor(darkCharcoal).fontSize(16).font(fontBold).text(tr.receipt, 50, 128, { align: 'center', width: 512 });

    // Order number box
    const leftBoxX = isArabic ? 312 : 50;
    const rightBoxX = isArabic ? 50 : 312;
    doc.rect(leftBoxX, 175, 250, 50).lineWidth(2).stroke(honeyGold);
    doc.fillColor(darkCharcoal).fontSize(10).font(fontRegular).text(tr.orderNumber, leftBoxX + 10, 182, { align: textAlign, width: 230 });
    doc.fillColor(honeyGold).fontSize(18).font(fontBold).text(order.order_number, leftBoxX + 10, 198, { align: textAlign, width: 230 });

    // Date and status box
    doc.rect(rightBoxX, 175, 250, 50).lineWidth(2).stroke(electricBlue);
    doc.fillColor(darkCharcoal).fontSize(10).font(fontRegular).text(tr.dateStatus, rightBoxX + 10, 182, { align: textAlign, width: 230 });
    const dateLocale = isArabic ? 'ar-SA' : 'en-US';
    const orderDate = order.created_at ? new Date(order.created_at).toLocaleDateString(dateLocale, { year: 'numeric', month: 'short', day: 'numeric' }) : 'N/A';
    const statusText = tr.statuses[order.status] || (order.status || 'PENDING').toUpperCase();
    doc.fillColor(electricBlue).fontSize(12).font(fontBold).text(orderDate + ' | ' + statusText, rightBoxX + 10, 200, { align: textAlign, width: 230 });

    // Customer Information Section
    doc.rect(50, 245, 512, 80).lineWidth(1).stroke('#DDDDDD');
    doc.rect(50, 245, 512, 25).fill('#F5F5F5');
    doc.fillColor(darkCharcoal).fontSize(12).font(fontBold).text(tr.customerInfo, 60, 252, { align: textAlign, width: 492 });

    doc.fillColor('#333333').fontSize(10).font(fontRegular);
    if (isArabic) {
      doc.text(order.first_name + ' ' + order.last_name + ' :' + tr.name.replace(':', ''), 60, 280, { align: 'right', width: 492 });
      doc.text(order.phone + ' :' + tr.phone.replace(':', ''), 60, 298, { align: 'right', width: 492 });
      doc.text(order.email + ' :' + tr.email.replace(':', ''), 60, 316, { align: 'right', width: 492 });
    } else {
      doc.text(tr.name, 60, 280);
      doc.font(fontBold).text(order.first_name + ' ' + order.last_name, 120, 280);
      doc.font(fontRegular).text(tr.phone, 300, 280);
      doc.font(fontBold).text(order.phone, 360, 280);
      doc.font(fontRegular).text(tr.email, 60, 300);
      doc.font(fontBold).text(order.email, 120, 300);
    }

    // Service Details Section
    doc.rect(50, 345, 512, 100).lineWidth(1).stroke('#DDDDDD');
    doc.rect(50, 345, 512, 25).fill(honeyGold);
    doc.fillColor('#FFFFFF').fontSize(12).font(fontBold).text(tr.serviceDetails, 60, 352, { align: textAlign, width: 492 });

    doc.fillColor('#333333').fontSize(10).font(fontRegular);
    const serviceLabel = tr.services[order.service_type] || order.service_type;
    if (isArabic) {
      doc.fillColor(honeyGold).font(fontBold).text(serviceLabel + ' :' + tr.serviceType.replace(':', ''), 60, 380, { align: 'right', width: 492 });
    } else {
      doc.text(tr.serviceType, 60, 380);
      doc.font(fontBold).fillColor(honeyGold).text(serviceLabel, 150, 380);
    }

    let yPos = 400;
    doc.fillColor('#333333');
    for (const [key, value] of Object.entries(serviceDetails)) {
      if (value && key !== 'files' && yPos < 440) {
        const formattedKey = key.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase());
        const displayValue = Array.isArray(value) ? value.join(', ') : String(value);
        if (isArabic) {
          doc.font(fontRegular).text(displayValue.substring(0, 50) + ' :' + formattedKey, 60, yPos, { align: 'right', width: 492 });
        } else {
          doc.font(fontRegular).text(formattedKey + ':', 60, yPos);
          doc.font(fontBold).text(displayValue.substring(0, 60), 180, yPos);
        }
        yPos += 18;
      }
    }

    // Cost Breakdown Section
    doc.rect(50, 465, 512, 100).lineWidth(1).stroke('#DDDDDD');
    doc.rect(50, 465, 512, 25).fill(electricBlue);
    doc.fillColor('#FFFFFF').fontSize(12).font(fontBold).text(tr.costBreakdown, 60, 472, { align: textAlign, width: 492 });

    yPos = 500;
    doc.fillColor('#333333').fontSize(10);
    for (const [key, value] of Object.entries(calculatedCosts)) {
      if (value && typeof value === 'number' && value > 0 && yPos < 550) {
        const formattedKey = key.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase());
        if (isArabic) {
          doc.font(fontBold).text('SAR ' + value, 60, yPos);
          doc.font(fontRegular).text(formattedKey, 200, yPos, { align: 'right', width: 350 });
        } else {
          doc.font(fontRegular).text(formattedKey, 60, yPos);
          doc.font(fontBold).text(value + ' SAR', 450, yPos, { align: 'right', width: 100 });
        }
        yPos += 18;
      }
    }

    // Total line
    doc.moveTo(50, 555).lineTo(562, 555).lineWidth(2).stroke(honeyGold);
    doc.fontSize(14).font(fontBold);
    if (isArabic) {
      if (order.total_cost) {
        doc.fillColor(honeyGold).text('SAR ' + order.total_cost, 60, 562);
      } else {
        doc.fillColor(electricBlue).fontSize(11).text(tr.tbd, 60, 564);
      }
      doc.fillColor(darkCharcoal).fontSize(14).text(tr.total, 400, 562, { align: 'right', width: 150 });
    } else {
      doc.fillColor(darkCharcoal).text(tr.total, 60, 562);
      if (order.total_cost) {
        doc.fillColor(honeyGold).text(order.total_cost + ' SAR', 400, 562, { align: 'right', width: 150 });
      } else {
        doc.fillColor(electricBlue).fontSize(11).text(tr.tbd, 250, 564, { align: 'right', width: 300 });
      }
    }

    // Terms box
    const termsBoxX = isArabic ? 210 : 50;
    doc.rect(termsBoxX, 590, 350, 80).lineWidth(1).stroke('#DDDDDD').fill('#FAFAFA');
    doc.fillColor('#666666').fontSize(9).font(fontBold).text(tr.keyTerms, termsBoxX + 8, 598, { align: textAlign, width: 334 });
    doc.font(fontRegular).fontSize(8);
    doc.text(tr.term1, termsBoxX + 8, 614, { align: textAlign, width: 334 });
    doc.text(tr.term2, termsBoxX + 8, 628, { align: textAlign, width: 334 });
    doc.text(tr.term3, termsBoxX + 8, 642, { align: textAlign, width: 334 });
    doc.text(tr.term4, termsBoxX + 8, 656, { align: textAlign, width: 334 });

    // Signature box
    const sigBoxX = isArabic ? 50 : 420;
    if (order.signature && order.signature.startsWith('data:image')) {
      doc.rect(sigBoxX, 590, 142, 80).lineWidth(1).stroke('#DDDDDD');
      doc.fillColor('#666666').fontSize(9).font(fontBold).text(tr.signature, sigBoxX + 8, 598, { align: textAlign, width: 126 });
      try {
        doc.image(order.signature, sigBoxX + 10, 615, { width: 120, height: 50 });
      } catch (e) {
        doc.font(fontRegular).text('[Signature on file]', sigBoxX + 10, 635);
      }
    }

    // Footer
    doc.rect(0, 700, 612, 92).fill(darkCharcoal);
    doc.fillColor('#AAAAAA').fontSize(9).font(fontRegular);
    doc.text(tr.footer1, 50, 715, { align: 'center', width: 512 });
    doc.text(tr.footer2 + new Date().toLocaleDateString(dateLocale) + ' | OHM HIVE', 50, 735, { align: 'center', width: 512 });

    doc.end();
  } catch (error) {
    console.error('Error generating PDF:', error);
    res.status(500).json({ error: error.message });
  }
});

// Serve uploaded files (for admin)
app.get('/uploads/:filename', (req, res) => {
  const filePath = path.join(UPLOADS_DIR, req.params.filename);
  if (fs.existsSync(filePath)) {
    res.sendFile(filePath);
  } else {
    res.status(404).send('File not found');
  }
});

// Initialize and start server
initDatabase().then(() => {
  app.listen(PORT, () => {
    console.log(`
╔═══════════════════════════════════════════════╗
║          OHM HIVE - Server Started            ║
╠═══════════════════════════════════════════════╣
║  Website:  http://localhost:${PORT}              ║
║  Admin:    http://localhost:${PORT}/admin        ║
╚═══════════════════════════════════════════════╝
    `);
  });
}).catch(err => {
  console.error('Failed to initialize database:', err);
  process.exit(1);
});
