const express = require('express');
const initSqlJs = require('sql.js');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');
const QRCode = require('qrcode');

const app = express();
const PORT = process.env.PORT || 3000;

// Cache invoice template at startup
let invoiceTemplate = '';
try {
  invoiceTemplate = fs.readFileSync(path.join(__dirname, 'views', 'invoice.html'), 'utf8');
  console.log('Invoice template loaded successfully');
} catch (e) {
  console.error('Failed to load invoice template:', e.message);
}

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

// Health check endpoint for Railway
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

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

// API: Generate HTML Invoice (print-ready, supports RTL for Arabic)
app.get('/api/orders/:orderNumber/invoice', async (req, res) => {
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
        footer2: 'Generated on:',
        printButton: 'Print Invoice',
        termsTitle: 'Terms and Conditions',
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
        terms: [
          { title: '1. Payment Terms', content: '• Payment is divided into two installments: 50% before commencement of work, and 50% upon completion.\n• Work shall commence only upon receipt of the first payment.\n• Final deliverables shall be released only upon receipt of the second payment.\n• All prices are final and non-negotiable.' },
          { title: '2. Components and Materials', content: '• The cost of electronic components and materials required for the project is not included in the service fee.\n• The customer is responsible for either providing the components directly or paying for their procurement.' },
          { title: '3. Delivery and Late Submission', content: '• Our team commits to delivering work by the agreed deadline.\n• Our team is responsible for submitting all files, documents, and deliverables as specified in the project description and requirements provided by the customer.\n• In the event of late delivery, the customer shall be compensated 200 SAR for each day of delay.' },
          { title: '4. Explanation Sessions', content: '• Course Projects: The service includes one complimentary explanation session to review the project implementation, and additional sessions are charged at 100 SAR per session.\n• Senior Projects: The service includes two meetings per month throughout the project duration, plus one preparation session before each presentation, and additional sessions are charged at 100 SAR per session.' },
          { title: '5. Adjustments', content: '• The customer is entitled to request adjustments for reports and presentations free of charge once, and subsequent adjustment requests are charged at 50 SAR per hour based on the time required to implement the adjustments.' },
          { title: '6. Scope of Services', content: '• Ohm Hive provides technical development and implementation services only.\n• We do not provide project ideas, nor do we evaluate or rate customer ideas.\n• Enhancement suggestions may be offered during development at the Engineer\'s discretion.\n• Ohm Hive is not responsible for the acceptance or rejection of the customer\'s idea by any academic institution or third party.' },
          { title: '7. Consulting Services', content: '• Consulting sessions are billed at 80 SAR per hour, and any time exceeding one hour—even by one minute—shall be billed as a full additional hour.' },
          { title: '8. Communication and Conduct', content: '• All communication shall be conducted via WhatsApp, email, or online meetings only. Face-to-face meetings may be arranged upon mutual agreement and subject to the Engineer\'s availability. Professional and respectful communication is required from both parties at all times.' },
          { title: '9. Termination', content: '• Failure to comply with these terms and conditions grants Ohm Hive the right to terminate the agreement immediately. In such cases, the customer shall not be entitled to claim any refunds.' }
        ]
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
        footer1: 'هذا إيصال مُنشأ إلكترونياً.',
        footer2: 'تاريخ الإنشاء:',
        printButton: 'طباعة الفاتورة',
        termsTitle: 'الشروط والأحكام',
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
        terms: [
          { title: '1. شروط الدفع', content: '• يتم تقسيم الدفع إلى قسطين: 50% قبل بدء العمل و 50% عند الانتهاء.\n• يبدأ العمل فقط عند استلام الدفعة الأولى.\n• لا يتم تسليم المخرجات النهائية إلا بعد استلام الدفعة الثانية كاملة.\n• التكلفة نهائية وغير قابلة للتفاوض.' },
          { title: '2. المكونات والمواد', content: '• تكلفة المكونات الإلكترونية والمواد المطلوبة للمشروع غير مشمولة في رسوم الخدمة.\n• العميل مسؤول عن توفير المكونات مباشرة أو دفع تكلفة شرائها.' },
          { title: '3. التسليم والتأخير', content: '• يلتزم فريقنا بتسليم العمل في الموعد المتفق عليه.\n• فريقنا مسؤول عن تسليم جميع الملفات والمستندات والمخرجات كما هو محدد في وصف المشروع والمتطلبات المقدمة من العميل.\n• في حال تأخر تسليم العمل عن الموعد المتفق عليه، يُعوَّض العميل بمبلغ (200) ريال عن كل يوم تأخير.' },
          { title: '4. جلسات الشرح', content: '• مشاريع المقررات: تشمل الخدمة جلسة شرح مجانية واحدة لمراجعة تنفيذ المشروع، وتُحتسب الجلسات الإضافية بمبلغ (100) ريال لكل جلسة.\n• مشاريع التخرج: تشمل الخدمة اجتماعَين شهريًا طوال مدة المشروع، بالإضافة إلى جلسة تحضيرية قبل كل عرض، وتُحتسب الجلسات الإضافية بمبلغ (100) ريال لكل جلسة.' },
          { title: '5. التعديلات', content: '• يحق للعميل طلب إجراء التعديلات على التقارير والعروض التقديمية مجانًا لمرة واحدة، وتُحتسب طلبات التعديل اللاحقة بمبلغ (50) ريال لكل ساعة، وفقًا للوقت المستغرق في تنفيذ التعديلات.' },
          { title: '6. نطاق الخدمات', content: '• يقدم Ohm Hive خدمات التطوير والتنفيذ التقني فقط.\n• نحن لا نقدم أفكار المشاريع ولا نقيّم أو نصنّف أفكار العملاء.\n• قد يتم تقديم اقتراحات للتحسين أثناء التطوير حسب تقدير المهندس المسؤول.\n• Ohm Hive غير مسؤول عن قبول أو رفض فكرة العميل من قبل أي مؤسسة أكاديمية أو طرف ثالث.' },
          { title: '7. خدمات الاستشارات', content: '• تُحتسب جلسات الاستشارة بالساعة بمبلغ (80) ريال لكل ساعة، وأي مدة تتجاوز ساعة واحدة - ولو بدقيقة واحدة - تُحتسب ساعة إضافية كاملة.' },
          { title: '8. التواصل والسلوك', content: '• جميع الاتصالات تتم عبر واتساب أو البريد الإلكتروني أو الاجتماعات عبر الإنترنت فقط. ويمكن ترتيب اجتماعات حضورية بالاتفاق المتبادل وحسب توفر المهندس. ويُشترط الالتزام بالتواصل المهني والمحترم من كلا الطرفين في جميع الأوقات.' },
          { title: '9. الإنهاء', content: '• يُعدّ عدم الامتثال لهذه الشروط والأحكام سببًا يخول Ohm Hive إنهاء الاتفاقية فورًا. وفي هذه الحالات، لا يحق للعميل المطالبة باسترداد أي مبالغ مدفوعة.' }
        ]
      }
    };
    const tr = t[lang] || t.en;

    // Generate QR code
    const qrData = JSON.stringify({
      orderNumber: order.order_number,
      customer: order.first_name + ' ' + order.last_name,
      service: order.service_type,
      date: order.created_at
    });
    const qrCodeDataUrl = await QRCode.toDataURL(qrData, { width: 100, margin: 1 });

    // Build cost items
    const costItems = [];
    if (order.total_cost) {
      costItems.push({ label: tr.baseCost, value: order.total_cost });
    }
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
    if (calculatedCosts.modelingHours) {
      costItems.push({ label: tr.modelingHours + ' (' + calculatedCosts.modelingHours + ' x 50 SAR)', value: calculatedCosts.modeling || (calculatedCosts.modelingHours * 50) });
    }

    // Calculate total
    let finalTotal = 0;
    for (const item of costItems) {
      finalTotal += item.value;
    }

    // Build cost items HTML
    let costItemsHtml = '';
    for (const item of costItems) {
      costItemsHtml += `<tr><td class="label">${item.label}</td><td class="value">${item.value} SAR</td></tr>`;
    }

    // Total display
    const totalDisplay = finalTotal > 0 ? `${finalTotal} SAR` : `<span class="tbd">${tr.tbd}</span>`;

    // Build service details HTML
    let serviceDetailsHtml = '';
    for (const [key, value] of Object.entries(serviceDetails)) {
      if (value && key !== 'files') {
        const formattedKey = key.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase());
        const displayValue = Array.isArray(value) ? value.join(', ') : String(value).substring(0, 100);
        serviceDetailsHtml += `<p><strong>${formattedKey}:</strong> ${displayValue}</p>`;
      }
    }

    // Build signature HTML
    let signatureHtml = '';
    if (order.signature && order.signature.startsWith('data:image')) {
      signatureHtml = `
        <div class="signature-box">
          <div class="label">${tr.signature}</div>
          <img src="${order.signature}" alt="Signature">
        </div>
      `;
    }

    // Build terms HTML
    let termsHtml = '';
    for (const term of tr.terms) {
      termsHtml += `
        <div class="term-section">
          <h3>${term.title}</h3>
          <p>${term.content}</p>
        </div>
      `;
    }

    // Format dates
    const dateLocale = isArabic ? 'ar-SA' : 'en-US';
    const orderDate = order.created_at ? new Date(order.created_at).toLocaleDateString(dateLocale, { year: 'numeric', month: 'short', day: 'numeric' }) : 'N/A';
    const generatedDate = new Date().toLocaleDateString(dateLocale);

    // Use cached template
    let html = invoiceTemplate;

    // Replace placeholders
    const replacements = {
      '{{lang}}': lang,
      '{{dir}}': isArabic ? 'rtl' : 'ltr',
      '{{tr.receipt}}': tr.receipt,
      '{{orderNumber}}': order.order_number,
      '{{tr.tagline}}': tr.tagline,
      '{{tr.contact}}': tr.contact,
      '{{qrCode}}': qrCodeDataUrl,
      '{{tr.orderNumber}}': tr.orderNumber,
      '{{tr.dateStatus}}': tr.dateStatus,
      '{{orderDate}}': orderDate,
      '{{orderStatus}}': tr.statuses[order.status] || (order.status || 'PENDING').toUpperCase(),
      '{{tr.customerInfo}}': tr.customerInfo,
      '{{tr.name}}': tr.name,
      '{{customerName}}': order.first_name + ' ' + order.last_name,
      '{{tr.phone}}': tr.phone,
      '{{phone}}': order.phone,
      '{{tr.email}}': tr.email,
      '{{email}}': order.email,
      '{{tr.serviceDetails}}': tr.serviceDetails,
      '{{tr.serviceType}}': tr.serviceType,
      '{{serviceName}}': tr.services[order.service_type] || order.service_type,
      '{{serviceDetailsHtml}}': serviceDetailsHtml,
      '{{tr.costBreakdown}}': tr.costBreakdown,
      '{{costItemsHtml}}': costItemsHtml,
      '{{tr.total}}': tr.total,
      '{{totalDisplay}}': totalDisplay,
      '{{signatureHtml}}': signatureHtml,
      '{{tr.footer1}}': tr.footer1,
      '{{tr.footer2}}': tr.footer2,
      '{{generatedDate}}': generatedDate,
      '{{tr.termsTitle}}': tr.termsTitle,
      '{{termsHtml}}': termsHtml,
      '{{footerText}}': isArabic ? 'OHM HIVE - حيث تنبض الأفكار بالحياة | واتساب: 0536113736' : 'OHM HIVE - Where Ideas Buzz to Life | WhatsApp: 0536113736',
      '{{printButton}}': tr.printButton,
      '{{labelAlign}}': isArabic ? 'right' : 'left',
      '{{valueAlign}}': isArabic ? 'left' : 'right'
    };

    for (const [key, value] of Object.entries(replacements)) {
      html = html.split(key).join(value);
    }

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch (error) {
    console.error('Error generating invoice:', error);
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

// Legacy PDF route - redirect to HTML invoice
app.get('/api/orders/:orderNumber/pdf', (req, res) => {
  const lang = req.query.lang || 'en';
  res.redirect(`/api/orders/${req.params.orderNumber}/invoice?lang=${lang}`);
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
