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

    // Parse totalCost - convert string to number, handle empty string
    const parsedTotalCost = totalCost && totalCost !== '' ? parseFloat(totalCost) : null;

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
      parsedTotalCost,
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
      totalCost: parsedTotalCost
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
        baseCost: 'Base Cost',
        report: 'Report',
        ppt: 'Presentation',
        consulting: 'Consulting',
        supervision: 'Follow-up',
        modeling: '3D Design',
        modelingHours: 'Design Hours',
        total: 'TOTAL:',
        tbd: 'To be determined later by engineer',
        signature: 'CUSTOMER SIGNATURE:',
        footer1: 'This is an electronically generated receipt.',
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
        statuses: { pending: 'PENDING', confirmed: 'CONFIRMED', 'in-progress': 'IN PROGRESS', completed: 'COMPLETED', cancelled: 'CANCELLED' },
        terms: {
          title: 'TERMS AND CONDITIONS',
          section1: { title: '1. Payment Terms', content: 'Payment is divided into two installments: 50% before commencement of work, and 50% upon completion. Work shall commence only upon receipt of the first payment. Final deliverables shall be released only upon receipt of the second payment. All prices are final and non-negotiable.' },
          section2: { title: '2. Components and Materials', content: 'The cost of electronic components and materials required for the project is not included in the service fee. The customer is responsible for either providing the components directly or paying for their procurement.' },
          section3: { title: '3. Delivery and Late Submission', content: 'Our team commits to delivering work by the agreed deadline. In the event of late delivery, the customer shall be compensated 200 SAR for each day of delay.' },
          section4: { title: '4. Explanation Sessions', content: 'Course Projects: One complimentary explanation session included. Senior Projects: Two meetings per month plus one preparation session before each presentation. Additional sessions: 100 SAR per session.' },
          section5: { title: '5. Adjustments', content: 'The customer is entitled to request adjustments for reports and presentations free of charge once. Subsequent adjustment requests are charged at 50 SAR per hour.' },
          section6: { title: '6. Scope of Services', content: 'Ohm Hive provides technical development and implementation services only. We do not provide project ideas, nor do we evaluate customer ideas. Ohm Hive is not responsible for the acceptance or rejection of the idea by any academic institution.' },
          section7: { title: '7. Consulting Services', content: 'Consulting sessions are billed at 80 SAR per hour. Any time exceeding one hour shall be billed as a full additional hour.' },
          section8: { title: '8. Communication', content: 'All communication shall be conducted via WhatsApp, email, or online meetings only. Professional and respectful communication is required from both parties.' },
          section9: { title: '9. Termination', content: 'Failure to comply with these terms grants Ohm Hive the right to terminate the agreement immediately. The customer shall not be entitled to claim any refunds.' }
        }
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
        baseCost: 'التكلفة الأساسية',
        report: 'التقرير',
        ppt: 'العرض التقديمي',
        consulting: 'الاستشارات',
        supervision: 'المتابعة',
        modeling: 'التصميم ثلاثي الأبعاد',
        modelingHours: 'ساعات التصميم',
        total: 'الإجمالي:',
        tbd: 'سيتم تحديدها لاحقاً',
        signature: 'توقيع العميل:',
        footer1: 'إيصال إلكتروني.',
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
        statuses: { pending: 'قيد الانتظار', confirmed: 'مؤكد', 'in-progress': 'قيد التنفيذ', completed: 'مكتمل', cancelled: 'ملغي' },
        terms: {
          title: 'الشروط والأحكام',
          section1: { title: '1. شروط الدفع', content: 'يتم تقسيم الدفع إلى قسطين: 50% قبل بدء العمل و 50% عند الانتهاء. يبدأ العمل فقط عند استلام الدفعة الأولى. لا يتم تسليم المخرجات النهائية إلا بعد استلام الدفعة الثانية كاملة. التكلفة نهائية وغير قابلة للتفاوض.' },
          section2: { title: '2. المكونات والمواد', content: 'تكلفة المكونات الإلكترونية والمواد المطلوبة للمشروع غير مشمولة في رسوم الخدمة. العميل مسؤول عن توفير المكونات مباشرة أو دفع تكلفة شرائها.' },
          section3: { title: '3. التسليم والتأخير', content: 'يلتزم فريقنا بتسليم العمل في الموعد المتفق عليه. في حال تأخر تسليم العمل، يُعوَّض العميل بمبلغ 200 ريال عن كل يوم تأخير.' },
          section4: { title: '4. جلسات الشرح', content: 'مشاريع المقررات: جلسة شرح مجانية واحدة. مشاريع التخرج: اجتماعَين شهريًا بالإضافة إلى جلسة تحضيرية قبل كل عرض. الجلسات الإضافية: 100 ريال لكل جلسة.' },
          section5: { title: '5. التعديلات', content: 'يحق للعميل طلب إجراء التعديلات على التقارير والعروض التقديمية مجانًا لمرة واحدة. طلبات التعديل اللاحقة تُحتسب بمبلغ 50 ريال لكل ساعة.' },
          section6: { title: '6. نطاق الخدمات', content: 'يقدم Ohm Hive خدمات التطوير والتنفيذ التقني فقط. نحن لا نقدم أفكار المشاريع ولا نقيّم أفكار العملاء. Ohm Hive غير مسؤول عن قبول أو رفض الفكرة من قبل أي مؤسسة أكاديمية.' },
          section7: { title: '7. خدمات الاستشارات', content: 'تُحتسب جلسات الاستشارة بمبلغ 80 ريال لكل ساعة. أي مدة تتجاوز ساعة واحدة تُحتسب ساعة إضافية كاملة.' },
          section8: { title: '8. التواصل', content: 'جميع الاتصالات تتم عبر واتساب أو البريد الإلكتروني أو الاجتماعات عبر الإنترنت فقط. يُشترط الالتزام بالتواصل المهني والمحترم من كلا الطرفين.' },
          section9: { title: '9. الإنهاء', content: 'عدم الامتثال لهذه الشروط يخول Ohm Hive إنهاء الاتفاقية فورًا. لا يحق للعميل المطالبة باسترداد أي مبالغ مدفوعة.' }
        }
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
    doc.fillColor(darkCharcoal).fontSize(18).font(fontBold).text(tr.receipt, 50, 126, { align: 'center', width: 512 });

    // Order number box
    const leftBoxX = isArabic ? 312 : 50;
    const rightBoxX = isArabic ? 50 : 312;
    doc.rect(leftBoxX, 175, 250, 50).lineWidth(2).stroke(honeyGold);
    doc.fillColor(darkCharcoal).fontSize(11).font(fontBold).text(tr.orderNumber, leftBoxX + 10, 182, { align: textAlign, width: 230 });
    doc.fillColor(honeyGold).fontSize(20).font(fontBold).text(order.order_number, leftBoxX + 10, 198, { align: textAlign, width: 230 });

    // Date and status box
    doc.rect(rightBoxX, 175, 250, 50).lineWidth(2).stroke(electricBlue);
    doc.fillColor(darkCharcoal).fontSize(11).font(fontBold).text(tr.dateStatus, rightBoxX + 10, 182, { align: textAlign, width: 230 });
    const dateLocale = isArabic ? 'ar-SA' : 'en-US';
    const orderDate = order.created_at ? new Date(order.created_at).toLocaleDateString(dateLocale, { year: 'numeric', month: 'short', day: 'numeric' }) : 'N/A';
    const statusText = tr.statuses[order.status] || (order.status || 'PENDING').toUpperCase();
    doc.fillColor(electricBlue).fontSize(14).font(fontBold).text(orderDate + ' | ' + statusText, rightBoxX + 10, 200, { align: textAlign, width: 230 });

    // Customer Information Section
    doc.rect(50, 245, 512, 70).lineWidth(1).stroke('#DDDDDD');
    doc.rect(50, 245, 512, 25).fill('#F5F5F5');
    doc.fillColor(darkCharcoal).fontSize(13).font(fontBold).text(tr.customerInfo, 60, 251, { align: textAlign, width: 492 });

    doc.fillColor('#333333').fontSize(11).font(fontBold);
    if (isArabic) {
      doc.text(order.first_name + ' ' + order.last_name + ' :' + tr.name.replace(':', ''), 60, 278, { align: 'right', width: 492 });
      doc.font(fontRegular).text(order.phone + ' :' + tr.phone.replace(':', ''), 60, 295, { align: 'right', width: 492 });
    } else {
      doc.text(tr.name + ' ' + order.first_name + ' ' + order.last_name, 60, 278);
      doc.font(fontRegular).text(tr.phone + ' ' + order.phone + '   |   ' + tr.email + ' ' + order.email, 60, 295);
    }

    // Service Details Section
    doc.rect(50, 330, 512, 80).lineWidth(1).stroke('#DDDDDD');
    doc.rect(50, 330, 512, 25).fill(honeyGold);
    doc.fillColor('#FFFFFF').fontSize(13).font(fontBold).text(tr.serviceDetails, 60, 336, { align: textAlign, width: 492 });

    doc.fillColor('#333333').fontSize(12).font(fontBold);
    const serviceLabel = tr.services[order.service_type] || order.service_type;
    if (isArabic) {
      doc.fillColor(honeyGold).text(serviceLabel + ' :' + tr.serviceType.replace(':', ''), 60, 365, { align: 'right', width: 492 });
    } else {
      doc.text(tr.serviceType + ' ' + serviceLabel, 60, 365);
    }

    let yPos = 385;
    doc.fillColor('#333333').fontSize(10);
    for (const [key, value] of Object.entries(serviceDetails)) {
      if (value && key !== 'files' && yPos < 405) {
        const formattedKey = key.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase());
        const displayValue = Array.isArray(value) ? value.join(', ') : String(value).substring(0, 60);
        if (isArabic) {
          doc.font(fontRegular).text(displayValue + ' :' + formattedKey, 60, yPos, { align: 'right', width: 492 });
        } else {
          doc.font(fontRegular).text(formattedKey + ': ' + displayValue, 60, yPos);
        }
        yPos += 16;
      }
    }

    // Cost Breakdown Section - Itemized
    const costSectionY = 425;
    const costItems = [];

    // Add base cost if set
    if (order.total_cost) {
      costItems.push({ label: tr.baseCost, value: order.total_cost });
    }

    // Add all calculated costs (report, ppt, consulting, supervision, modeling, etc.)
    for (const [key, value] of Object.entries(calculatedCosts)) {
      if (value && typeof value === 'number' && value > 0 && key !== 'modelingHours') {
        let label = key;
        if (key === 'report') label = tr.report;
        else if (key === 'ppt') label = tr.ppt;
        else if (key === 'consulting') label = tr.consulting;
        else if (key === 'supervision') label = tr.supervision;
        else if (key === 'modeling') label = tr.modeling;
        else label = key.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase());
        costItems.push({ label, value });
      }
    }

    // If modeling hours exist, show that info
    if (calculatedCosts.modelingHours) {
      costItems.push({ label: tr.modelingHours + ' (' + calculatedCosts.modelingHours + ' x 50 SAR)', value: calculatedCosts.modeling || (calculatedCosts.modelingHours * 50) });
    }

    const costBoxHeight = Math.max(80, 30 + costItems.length * 20 + 30);
    doc.rect(50, costSectionY, 512, costBoxHeight).lineWidth(1).stroke('#DDDDDD');
    doc.rect(50, costSectionY, 512, 25).fill(electricBlue);
    doc.fillColor('#FFFFFF').fontSize(13).font(fontBold).text(tr.costBreakdown, 60, costSectionY + 6, { align: textAlign, width: 492 });

    yPos = costSectionY + 35;
    doc.fillColor('#333333').fontSize(11);

    // Draw each cost item
    for (const item of costItems) {
      if (isArabic) {
        doc.font(fontBold).text(item.value + ' SAR', 60, yPos);
        doc.font(fontRegular).text(item.label, 200, yPos, { align: 'right', width: 350 });
      } else {
        doc.font(fontRegular).text(item.label, 70, yPos);
        doc.font(fontBold).text(item.value + ' SAR', 420, yPos, { align: 'right', width: 130 });
      }
      yPos += 20;
    }

    // Calculate final total
    let finalTotal = 0;
    for (const item of costItems) {
      finalTotal += item.value;
    }

    // Total line
    const totalLineY = costSectionY + costBoxHeight - 25;
    doc.moveTo(60, totalLineY).lineTo(552, totalLineY).lineWidth(2).stroke(honeyGold);
    doc.fontSize(14).font(fontBold);
    if (isArabic) {
      if (finalTotal > 0) {
        doc.fillColor(honeyGold).text(finalTotal + ' SAR', 60, totalLineY + 7);
      } else {
        doc.fillColor(electricBlue).fontSize(12).text(tr.tbd, 60, totalLineY + 7);
      }
      doc.fillColor(darkCharcoal).fontSize(14).text(tr.total, 400, totalLineY + 7, { align: 'right', width: 150 });
    } else {
      doc.fillColor(darkCharcoal).text(tr.total, 70, totalLineY + 7);
      if (finalTotal > 0) {
        doc.fillColor(honeyGold).text(finalTotal + ' SAR', 420, totalLineY + 7, { align: 'right', width: 130 });
      } else {
        doc.fillColor(electricBlue).fontSize(12).text(tr.tbd, 420, totalLineY + 7, { align: 'right', width: 130 });
      }
    }

    // Signature box
    const sigStartY = costSectionY + costBoxHeight + 15;
    if (order.signature && order.signature.startsWith('data:image')) {
      doc.rect(50, sigStartY, 200, 70).lineWidth(1).stroke('#DDDDDD');
      doc.fillColor('#666666').fontSize(11).font(fontBold).text(tr.signature, 60, sigStartY + 8, { align: textAlign, width: 180 });
      try {
        doc.image(order.signature, 60, sigStartY + 25, { width: 170, height: 40 });
      } catch (e) {
        doc.font(fontRegular).text('[Signature on file]', 60, sigStartY + 40);
      }
    }

    // Footer on page 1
    doc.rect(0, 720, 612, 72).fill(darkCharcoal);
    doc.fillColor('#AAAAAA').fontSize(10).font(fontRegular);
    doc.text(tr.footer1, 50, 735, { align: 'center', width: 512 });
    doc.text(tr.footer2 + new Date().toLocaleDateString(dateLocale) + ' | OHM HIVE', 50, 752, { align: 'center', width: 512 });

    // ========== PAGE 2: TERMS AND CONDITIONS ==========
    doc.addPage();

    // Header for terms page
    doc.rect(0, 0, 612, 80).fill(darkCharcoal);
    doc.fillColor(honeyGold).fontSize(24).font(fontBold).text('OHM HIVE', 50, 25, { align: 'center', width: 512 });
    doc.fillColor('#FFFFFF').fontSize(16).font(fontBold).text(tr.terms.title, 50, 55, { align: 'center', width: 512 });

    // Terms content
    let termsY = 100;
    const termSections = ['section1', 'section2', 'section3', 'section4', 'section5', 'section6', 'section7', 'section8', 'section9'];

    doc.fillColor('#333333');
    for (const section of termSections) {
      if (termsY > 700) {
        doc.addPage();
        termsY = 50;
      }

      const term = tr.terms[section];

      // Section title
      doc.fontSize(12).font(fontBold).fillColor(honeyGold);
      if (isArabic) {
        doc.text(term.title, 50, termsY, { align: 'right', width: 512 });
      } else {
        doc.text(term.title, 50, termsY);
      }
      termsY += 20;

      // Section content
      doc.fontSize(10).font(fontRegular).fillColor('#333333');
      if (isArabic) {
        doc.text(term.content, 50, termsY, { align: 'right', width: 512, lineGap: 3 });
      } else {
        doc.text(term.content, 50, termsY, { width: 512, lineGap: 3 });
      }

      // Calculate height of text and move position
      const textHeight = doc.heightOfString(term.content, { width: 512, lineGap: 3 });
      termsY += textHeight + 20;
    }

    // Final footer
    if (termsY > 700) {
      doc.addPage();
      termsY = 50;
    }
    doc.rect(0, 720, 612, 72).fill(darkCharcoal);
    doc.fillColor('#AAAAAA').fontSize(9).font(fontRegular);
    doc.text('OHM HIVE - Where Ideas Buzz to Life | WhatsApp: 0536113736', 50, 745, { align: 'center', width: 512 });

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
