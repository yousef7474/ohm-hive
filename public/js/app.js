// OHM HIVE - Main Application JavaScript

// Global state
let currentLang = localStorage.getItem('ohmhive_lang') || 'ar';
let translations = {};
let signaturePad = null;

// Color definitions for 3D printing
const printColors = {
  red: '#FF0000',
  black: '#000000',
  white: '#FFFFFF',
  blue: '#0066FF',
  green: '#00AA00',
  orange: '#FF6600',
  yellow: '#FFCC00',
  brown: '#8B4513',
  engineRed: '#8B0000',
  lightBlue: '#87CEEB',
  darkBlue: '#00008B',
  darkGreen: '#006400',
  limeGreen: '#32CD32',
  gray: '#808080',
  pink: '#FF69B4',
  purple: '#800080',
  copper: '#B87333',
  golden: '#FFD700'
};

// Initialize application
document.addEventListener('DOMContentLoaded', async () => {
  await loadTranslations();
  initLanguageSwitcher();
  initNavigation();
  initServiceCards();
  initServiceForm();
  initSignaturePad();
  initFormSubmission();
  initModal();
  setCurrentYear();
  applyTranslations();
});

// Load translations
async function loadTranslations() {
  try {
    const [enRes, arRes] = await Promise.all([
      fetch('/translations/en.json'),
      fetch('/translations/ar.json')
    ]);
    translations.en = await enRes.json();
    translations.ar = await arRes.json();
  } catch (error) {
    console.error('Error loading translations:', error);
  }
}

// Get nested translation value
function getTranslation(key) {
  const keys = key.split('.');
  let value = translations[currentLang];
  for (const k of keys) {
    if (value && value[k]) {
      value = value[k];
    } else {
      return key;
    }
  }
  return value;
}

// Apply translations to all elements
function applyTranslations() {
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    const text = getTranslation(key);
    if (el.tagName === 'INPUT' && el.type === 'text') {
      el.placeholder = text;
    } else {
      el.textContent = text;
    }
  });

  // Update select options
  document.querySelectorAll('select option[data-i18n]').forEach(option => {
    const key = option.getAttribute('data-i18n');
    option.textContent = getTranslation(key);
  });

  // Render terms content
  renderTermsContent();
}

// Render terms and conditions
function renderTermsContent() {
  const termsContainer = document.getElementById('termsContent');
  if (!termsContainer) return;

  const terms = getTranslation('termsContent');
  let html = `<h4>${terms.title}</h4>`;

  for (let i = 1; i <= 10; i++) {
    const section = terms[`section${i}`];
    if (section) {
      html += `<h4>${section.title}</h4><ul>`;
      section.content.forEach(item => {
        html += `<li>${item}</li>`;
      });
      html += '</ul>';
    }
  }

  termsContainer.innerHTML = html;
}

// Language switcher
function initLanguageSwitcher() {
  const langBtns = document.querySelectorAll('.lang-btn');

  // Apply saved language on load
  document.documentElement.lang = currentLang;
  document.documentElement.dir = currentLang === 'ar' ? 'rtl' : 'ltr';

  // Set correct button as active based on saved language
  langBtns.forEach(btn => {
    const btnLang = btn.getAttribute('data-lang');
    if (btnLang === currentLang) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });

  // Add click handlers
  langBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const lang = btn.getAttribute('data-lang');
      if (lang !== currentLang) {
        currentLang = lang;
        localStorage.setItem('ohmhive_lang', lang);
        langBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        // Update document direction
        document.documentElement.lang = lang;
        document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';

        applyTranslations();
      }
    });
  });
}

// Navigation
function initNavigation() {
  const navToggle = document.querySelector('.nav-toggle');
  const navMenu = document.querySelector('.nav-menu');

  if (navToggle && navMenu) {
    navToggle.addEventListener('click', () => {
      navMenu.classList.toggle('active');
    });

    // Close menu on link click
    navMenu.querySelectorAll('a').forEach(link => {
      link.addEventListener('click', () => {
        navMenu.classList.remove('active');
      });
    });
  }
}

// Service cards click handler
function initServiceCards() {
  document.querySelectorAll('.service-card').forEach(card => {
    card.addEventListener('click', () => {
      const service = card.getAttribute('data-service');
      const serviceSelect = document.getElementById('serviceType');
      if (serviceSelect) {
        serviceSelect.value = service;
        serviceSelect.dispatchEvent(new Event('change'));
        document.getElementById('order').scrollIntoView({ behavior: 'smooth' });
      }
    });
  });
}

// Service form dynamic fields
function initServiceForm() {
  const serviceSelect = document.getElementById('serviceType');
  if (serviceSelect) {
    serviceSelect.addEventListener('change', (e) => {
      renderServiceFields(e.target.value);
      updateCostSummary();
    });
  }
}

// Render service-specific fields
function renderServiceFields(serviceType) {
  const container = document.getElementById('serviceFields');
  if (!container) return;

  let html = '';

  switch (serviceType) {
    case 'course-project':
      html = renderCourseProjectFields();
      break;
    case 'senior-project':
      html = renderSeniorProjectFields();
      break;
    case 'consulting':
      html = renderConsultingFields();
      break;
    case 'supervision':
      html = renderSupervisionFields();
      break;
    case '3d-modeling':
      html = render3DModelingFields();
      break;
    case '3d-printing':
      html = render3DPrintingFields();
      break;
    case 'homework':
      html = renderHomeworkFields();
      break;
    default:
      html = '';
  }

  container.innerHTML = html;

  // Reinitialize event listeners for dynamic fields
  initDynamicFieldListeners();
}

function renderCourseProjectFields() {
  return `
    <h3 data-i18n="services.courseProject.title">${getTranslation('services.courseProject.title')}</h3>
    <div class="form-group">
      <label data-i18n="form.projectIdea">${getTranslation('form.projectIdea')}</label>
      <textarea id="projectIdea" name="projectIdea" placeholder="${getTranslation('form.projectIdeaPlaceholder')}" required></textarea>
    </div>
    <div class="form-group">
      <label data-i18n="form.deadline">${getTranslation('form.deadline')}</label>
      <input type="date" id="deadline" name="deadline" required min="${getTodayDate()}">
    </div>
    <div class="form-group">
      <label data-i18n="form.reportRequired">${getTranslation('form.reportRequired')}</label>
      <div class="radio-group">
        <label><input type="radio" name="reportRequired" value="yes" onchange="updateCostSummary()"> ${getTranslation('form.yes')} (+700 SAR)</label>
        <label><input type="radio" name="reportRequired" value="no" checked onchange="updateCostSummary()"> ${getTranslation('form.no')}</label>
      </div>
    </div>
    <div class="form-group">
      <label data-i18n="form.pptRequired">${getTranslation('form.pptRequired')}</label>
      <div class="radio-group">
        <label><input type="radio" name="pptRequired" value="yes" onchange="updateCostSummary()"> ${getTranslation('form.yes')} (+250 SAR)</label>
        <label><input type="radio" name="pptRequired" value="no" checked onchange="updateCostSummary()"> ${getTranslation('form.no')}</label>
      </div>
    </div>
  `;
}

function renderSeniorProjectFields() {
  return `
    <h3 data-i18n="services.seniorProject.title">${getTranslation('services.seniorProject.title')}</h3>
    <div class="form-group">
      <label data-i18n="form.projectIdea">${getTranslation('form.projectIdea')}</label>
      <textarea id="projectIdea" name="projectIdea" placeholder="${getTranslation('form.projectIdeaPlaceholder')}" required></textarea>
    </div>
    <div class="form-group">
      <label data-i18n="form.deadline">${getTranslation('form.deadline')}</label>
      <input type="date" id="deadline" name="deadline" required min="${getTodayDate()}">
    </div>
    <div class="form-group">
      <label data-i18n="form.reportRequired">${getTranslation('form.reportRequired')}</label>
      <div class="radio-group">
        <label><input type="radio" name="reportRequired" value="yes" onchange="updateCostSummary()"> ${getTranslation('form.yes')} (+1200 SAR)</label>
        <label><input type="radio" name="reportRequired" value="no" checked onchange="updateCostSummary()"> ${getTranslation('form.no')}</label>
      </div>
    </div>
    <div class="form-group">
      <label data-i18n="form.pptRequired">${getTranslation('form.pptRequired')}</label>
      <div class="radio-group">
        <label><input type="radio" name="pptRequired" value="yes" onchange="updateCostSummary()"> ${getTranslation('form.yes')} (+400 SAR)</label>
        <label><input type="radio" name="pptRequired" value="no" checked onchange="updateCostSummary()"> ${getTranslation('form.no')}</label>
      </div>
    </div>
  `;
}

function renderConsultingFields() {
  return `
    <h3 data-i18n="services.consulting.title">${getTranslation('services.consulting.title')}</h3>
    <div class="form-group">
      <label data-i18n="form.consultingHours">${getTranslation('form.consultingHours')}</label>
      <input type="number" id="consultingHours" name="consultingHours" min="1" value="1" onchange="updateCostSummary()">
      <p style="color: rgba(255,248,240,0.6); font-size: 0.9rem; margin-top: 5px;">80 SAR ${currentLang === 'ar' ? 'لكل ساعة' : 'per hour'}</p>
    </div>
  `;
}

// Supervision pricing per month (distributed from 1,800 to 6,500 SAR)
const supervisionPrices = {
  1: 1800,
  2: 2500,
  3: 3150,
  4: 3800,
  5: 4500,
  6: 5150,
  7: 5850,
  8: 6500
};

function renderSupervisionFields() {
  return `
    <h3 data-i18n="services.supervision.title">${getTranslation('services.supervision.title')}</h3>
    <div class="form-group">
      <label data-i18n="form.projectIdea">${getTranslation('form.projectIdea')}</label>
      <textarea id="projectIdea" name="projectIdea" placeholder="${getTranslation('form.projectIdeaPlaceholder')}" required></textarea>
    </div>
    <div class="form-group">
      <label data-i18n="form.supervisionPeriod">${getTranslation('form.supervisionPeriod')}</label>
      <div class="period-grid">
        ${[1,2,3,4,5,6,7,8].map(m => `
          <div class="period-option">
            <input type="radio" name="supervisionPeriod" value="${m}" id="period${m}" ${m === 1 ? 'checked' : ''} onchange="updateCostSummary()">
            <label for="period${m}">
              <strong>${m}</strong>
              <span>${m === 1 ? getTranslation('form.month') : getTranslation('form.months')}</span>
              <span style="display:block; color: var(--honey-gold); font-size: 0.8rem;">${supervisionPrices[m].toLocaleString()} SAR</span>
            </label>
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

function render3DModelingFields() {
  return `
    <h3 data-i18n="services.modeling.title">${getTranslation('services.modeling.title')}</h3>
    <div class="form-group">
      <label data-i18n="form.modelDescription">${getTranslation('form.modelDescription')}</label>
      <textarea id="modelDescription" name="modelDescription" placeholder="${getTranslation('form.modelDescriptionPlaceholder')}" required></textarea>
    </div>
    <p style="color: var(--electric-blue); font-size: 0.9rem; margin-top: 15px; padding: 15px; background: rgba(45, 156, 219, 0.1); border-radius: 8px; border: 1px solid rgba(45, 156, 219, 0.3);">
      ${currentLang === 'ar' ? 'التكلفة: 50 ريال لكل ساعة (سيتم تحديد عدد الساعات من قبل المهندس بعد مراجعة الطلب)' : 'Cost: 50 SAR per hour (hours will be determined by the engineer after reviewing the request)'}
    </p>
  `;
}

function render3DPrintingFields() {
  const colorEntries = Object.entries(printColors);
  return `
    <h3 data-i18n="services.printing.title">${getTranslation('services.printing.title')}</h3>
    <div class="form-group">
      <label data-i18n="form.upload3DFile">${getTranslation('form.upload3DFile')}</label>
      <div class="file-upload" onclick="document.getElementById('printFile').click()">
        <label class="file-upload-label">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
            <polyline points="17 8 12 3 7 8"/>
            <line x1="12" y1="3" x2="12" y2="15"/>
          </svg>
          <span>${currentLang === 'ar' ? 'اضغط لرفع الملف' : 'Click to upload'}</span>
          <span style="font-size: 0.8rem; color: rgba(255,248,240,0.5)">STL, 3MF</span>
        </label>
        <input type="file" id="printFile" name="printFile" accept=".stl,.3mf" onchange="showFileName(this, 'printFileName')">
        <div id="printFileName" class="file-name"></div>
      </div>
    </div>
    <div class="form-group">
      <label data-i18n="form.selectColor">${getTranslation('form.selectColor')}</label>
      <div class="color-grid">
        ${colorEntries.map(([name, color], index) => `
          <div class="color-option">
            <input type="radio" name="printColor" value="${name}" id="color${name}" ${index === 0 ? 'checked' : ''}>
            <label for="color${name}" style="background-color: ${color}; ${color === '#FFFFFF' ? 'border: 1px solid #ccc;' : ''}" title="${getTranslation('colors.' + name)}"></label>
          </div>
        `).join('')}
      </div>
    </div>
    <div class="form-group">
      <label data-i18n="form.selectMaterial">${getTranslation('form.selectMaterial')}</label>
      <div class="material-grid">
        ${['PLA', 'PETG', 'TPU', 'ABS'].map((mat, index) => `
          <div class="material-option">
            <input type="radio" name="printMaterial" value="${mat}" id="material${mat}" ${index === 0 ? 'checked' : ''}>
            <label for="material${mat}">${mat}</label>
          </div>
        `).join('')}
      </div>
    </div>
    <p style="color: var(--electric-blue); font-size: 0.9rem; margin-top: 15px;">
      ${currentLang === 'ar' ? 'التكلفة: 3 ريال لكل جرام (سيتم تحديد الوزن من قبل المهندس)' : 'Cost: 3 SAR per gram (weight will be determined by engineer)'}
    </p>
  `;
}

function renderHomeworkFields() {
  const software = ['MATLAB', 'Simulink', 'Proteus', 'Multisim', 'KiCAD', 'Flux', 'Fritzing'];
  return `
    <h3 data-i18n="services.homework.title">${getTranslation('services.homework.title')}</h3>
    <div class="form-group">
      <label data-i18n="form.homeworkDetails">${getTranslation('form.homeworkDetails')}</label>
      <textarea id="homeworkDetails" name="homeworkDetails" placeholder="${getTranslation('form.homeworkDetailsPlaceholder')}" required></textarea>
    </div>
    <div class="form-group">
      <label data-i18n="form.deadline">${getTranslation('form.deadline')}</label>
      <input type="date" id="deadline" name="deadline" required min="${getTodayDate()}">
    </div>
    <div class="form-group">
      <label data-i18n="form.uploadHomework">${getTranslation('form.uploadHomework')}</label>
      <div class="file-upload" onclick="document.getElementById('homeworkFile').click()">
        <label class="file-upload-label">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
            <polyline points="17 8 12 3 7 8"/>
            <line x1="12" y1="3" x2="12" y2="15"/>
          </svg>
          <span>${currentLang === 'ar' ? 'اضغط لرفع الملف' : 'Click to upload'}</span>
          <span style="font-size: 0.8rem; color: rgba(255,248,240,0.5)">PNG, JPG, PDF, DOC, DOCX</span>
        </label>
        <input type="file" id="homeworkFile" name="homeworkFile" accept=".png,.jpg,.jpeg,.pdf,.doc,.docx" onchange="showFileName(this, 'homeworkFileName')">
        <div id="homeworkFileName" class="file-name"></div>
      </div>
    </div>
    <div class="form-group">
      <label data-i18n="form.selectSoftware">${getTranslation('form.selectSoftware')}</label>
      <div class="software-grid">
        ${software.map(sw => `
          <div class="software-option">
            <input type="checkbox" name="software" value="${sw}" id="sw${sw}">
            <label for="sw${sw}">${sw}</label>
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

// Show uploaded file name
function showFileName(input, containerId) {
  const container = document.getElementById(containerId);
  if (input.files && input.files[0]) {
    container.textContent = input.files[0].name;
  }
}

// Make function global
window.showFileName = showFileName;

// Get today's date for min date attribute
function getTodayDate() {
  const today = new Date();
  return today.toISOString().split('T')[0];
}

// Initialize dynamic field listeners
function initDynamicFieldListeners() {
  // Any additional listeners for dynamic fields
}

// Update cost summary
function updateCostSummary() {
  const serviceType = document.getElementById('serviceType').value;
  const costSummary = document.getElementById('costSummary');
  const costBreakdown = document.getElementById('costBreakdown');

  if (!serviceType || !costSummary || !costBreakdown) return;

  let costs = {};
  let total = 0;
  let hasTBD = false;

  switch (serviceType) {
    case 'course-project':
      costs.baseCost = getTranslation('form.toBeDetemined');
      hasTBD = true;
      if (document.querySelector('input[name="reportRequired"]:checked')?.value === 'yes') {
        costs.report = 700;
        total += 700;
      }
      if (document.querySelector('input[name="pptRequired"]:checked')?.value === 'yes') {
        costs.ppt = 250;
        total += 250;
      }
      break;

    case 'senior-project':
      costs.baseCost = getTranslation('form.toBeDetemined');
      hasTBD = true;
      if (document.querySelector('input[name="reportRequired"]:checked')?.value === 'yes') {
        costs.report = 1200;
        total += 1200;
      }
      if (document.querySelector('input[name="pptRequired"]:checked')?.value === 'yes') {
        costs.ppt = 400;
        total += 400;
      }
      break;

    case 'consulting':
      const hours = parseInt(document.getElementById('consultingHours')?.value) || 1;
      costs.consulting = hours * 80;
      total = costs.consulting;
      break;

    case 'supervision':
      const months = parseInt(document.querySelector('input[name="supervisionPeriod"]:checked')?.value) || 1;
      costs.supervision = supervisionPrices[months] || 2500;
      total = costs.supervision;
      break;

    case '3d-modeling':
      costs.baseCost = getTranslation('form.toBeDetemined');
      hasTBD = true;
      break;

    case '3d-printing':
      costs.baseCost = getTranslation('form.toBeDetemined');
      hasTBD = true;
      break;

    case 'homework':
      costs.baseCost = getTranslation('form.toBeDetemined');
      hasTBD = true;
      break;
  }

  // Render cost breakdown
  let html = '';
  for (const [key, value] of Object.entries(costs)) {
    const label = key === 'baseCost' ? getTranslation('form.baseCost') :
                  key === 'report' ? (currentLang === 'ar' ? 'تقرير' : 'Report') :
                  key === 'ppt' ? (currentLang === 'ar' ? 'عرض تقديمي' : 'Presentation') :
                  key === 'consulting' ? (currentLang === 'ar' ? 'استشارات' : 'Consulting') :
                  key === 'supervision' ? (currentLang === 'ar' ? 'متابعة' : 'Follow-up') : key;

    if (typeof value === 'number') {
      html += `<div class="cost-item"><span>${label}</span><span>${value} SAR</span></div>`;
    } else {
      html += `<div class="cost-item"><span>${label}</span><span class="cost-tbd">${value}</span></div>`;
    }
  }

  if (hasTBD) {
    html += `<div class="cost-item total"><span>${getTranslation('form.total')}</span><span>${total > 0 ? total + ' SAR + ' : ''}${getTranslation('form.toBeDetemined')}</span></div>`;
  } else {
    html += `<div class="cost-item total"><span>${getTranslation('form.total')}</span><span>${total} SAR</span></div>`;
  }

  costBreakdown.innerHTML = html;
  costSummary.style.display = 'block';
}

// Make function global
window.updateCostSummary = updateCostSummary;

// Initialize signature pad
function initSignaturePad() {
  const canvas = document.getElementById('signaturePad');
  if (!canvas) return;

  const ctx = canvas.getContext('2d');
  let isDrawing = false;
  let lastX = 0;
  let lastY = 0;

  // Set canvas size
  function resizeCanvas() {
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width;
    canvas.height = rect.height;
    ctx.strokeStyle = '#1A1A2E';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
  }

  resizeCanvas();
  window.addEventListener('resize', resizeCanvas);

  function getPosition(e) {
    const rect = canvas.getBoundingClientRect();
    if (e.touches) {
      return {
        x: e.touches[0].clientX - rect.left,
        y: e.touches[0].clientY - rect.top
      };
    }
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top
    };
  }

  function startDrawing(e) {
    isDrawing = true;
    const pos = getPosition(e);
    lastX = pos.x;
    lastY = pos.y;
  }

  function draw(e) {
    if (!isDrawing) return;
    e.preventDefault();

    const pos = getPosition(e);
    ctx.beginPath();
    ctx.moveTo(lastX, lastY);
    ctx.lineTo(pos.x, pos.y);
    ctx.stroke();
    lastX = pos.x;
    lastY = pos.y;
  }

  function stopDrawing() {
    isDrawing = false;
  }

  // Mouse events
  canvas.addEventListener('mousedown', startDrawing);
  canvas.addEventListener('mousemove', draw);
  canvas.addEventListener('mouseup', stopDrawing);
  canvas.addEventListener('mouseout', stopDrawing);

  // Touch events
  canvas.addEventListener('touchstart', startDrawing, { passive: false });
  canvas.addEventListener('touchmove', draw, { passive: false });
  canvas.addEventListener('touchend', stopDrawing);

  // Clear button
  const clearBtn = document.getElementById('clearSignature');
  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    });
  }

  signaturePad = {
    canvas,
    ctx,
    isEmpty: () => {
      const pixelData = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      return !pixelData.some((channel, index) => index % 4 !== 3 && channel !== 0);
    },
    toDataURL: () => canvas.toDataURL()
  };
}

// Form submission
function initFormSubmission() {
  const form = document.getElementById('orderForm');
  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    // Validate
    if (!validateForm()) return;

    // Get form data
    const formData = new FormData(form);
    const serviceType = formData.get('serviceType');

    // Collect service details
    const serviceDetails = collectServiceDetails(serviceType);

    // Collect calculated costs and total
    const { costs: calculatedCosts, total: totalCost } = collectCalculatedCosts(serviceType);

    // Get signature
    const signature = signaturePad ? signaturePad.toDataURL() : null;

    // Prepare submission data
    const submitData = new FormData();
    submitData.append('firstName', formData.get('firstName'));
    submitData.append('lastName', formData.get('lastName'));
    submitData.append('phone', formData.get('phone'));
    submitData.append('email', formData.get('email'));
    submitData.append('serviceType', serviceType);
    submitData.append('serviceDetails', JSON.stringify(serviceDetails));
    submitData.append('calculatedCosts', JSON.stringify(calculatedCosts));
    submitData.append('totalCost', totalCost || '');
    submitData.append('signature', signature);

    // Add files if any
    const printFile = document.getElementById('printFile');
    if (printFile && printFile.files[0]) {
      submitData.append('files', printFile.files[0]);
    }
    const homeworkFile = document.getElementById('homeworkFile');
    if (homeworkFile && homeworkFile.files[0]) {
      submitData.append('files', homeworkFile.files[0]);
    }

    // Submit
    const submitBtn = form.querySelector('button[type="submit"]');
    submitBtn.classList.add('loading');

    try {
      const response = await fetch('/api/orders', {
        method: 'POST',
        body: submitData
      });

      const result = await response.json();

      if (result.success) {
        showConfirmation(result.orderNumber, serviceType, serviceDetails, calculatedCosts, totalCost);
        form.reset();
        document.getElementById('serviceFields').innerHTML = '';
        document.getElementById('costSummary').style.display = 'none';
        if (signaturePad) {
          signaturePad.ctx.clearRect(0, 0, signaturePad.canvas.width, signaturePad.canvas.height);
        }
      } else {
        alert('Error submitting order. Please try again.');
      }
    } catch (error) {
      console.error('Error:', error);
      alert('Error submitting order. Please try again.');
    } finally {
      submitBtn.classList.remove('loading');
    }
  });
}

// Validate form
function validateForm() {
  let isValid = true;

  // Check required fields
  const requiredFields = document.querySelectorAll('#orderForm [required]');
  requiredFields.forEach(field => {
    if (!field.value) {
      field.closest('.form-group')?.classList.add('error');
      isValid = false;
    } else {
      field.closest('.form-group')?.classList.remove('error');
    }
  });

  // Check terms agreement
  const agreeTerms = document.getElementById('agreeTerms');
  if (!agreeTerms.checked) {
    alert(getTranslation('validation.agreeTerms'));
    isValid = false;
  }

  // Check signature
  if (signaturePad && signaturePad.isEmpty()) {
    alert(getTranslation('validation.signatureRequired'));
    isValid = false;
  }

  return isValid;
}

// Collect service details based on type
function collectServiceDetails(serviceType) {
  const details = {};

  switch (serviceType) {
    case 'course-project':
    case 'senior-project':
      details.projectIdea = document.getElementById('projectIdea')?.value;
      details.deadline = document.getElementById('deadline')?.value;
      details.reportRequired = document.querySelector('input[name="reportRequired"]:checked')?.value;
      details.pptRequired = document.querySelector('input[name="pptRequired"]:checked')?.value;
      break;

    case 'consulting':
      details.hours = document.getElementById('consultingHours')?.value;
      break;

    case 'supervision':
      details.projectIdea = document.getElementById('projectIdea')?.value;
      details.period = document.querySelector('input[name="supervisionPeriod"]:checked')?.value;
      break;

    case '3d-modeling':
      details.modelDescription = document.getElementById('modelDescription')?.value;
      break;

    case '3d-printing':
      details.color = document.querySelector('input[name="printColor"]:checked')?.value;
      details.material = document.querySelector('input[name="printMaterial"]:checked')?.value;
      break;

    case 'homework':
      details.homeworkDetails = document.getElementById('homeworkDetails')?.value;
      details.deadline = document.getElementById('deadline')?.value;
      const selectedSoftware = [];
      document.querySelectorAll('input[name="software"]:checked').forEach(sw => {
        selectedSoftware.push(sw.value);
      });
      details.software = selectedSoftware;
      break;
  }

  return details;
}

// Collect calculated costs and total
function collectCalculatedCosts(serviceType) {
  const costs = {};
  let total = null; // null means TBD

  switch (serviceType) {
    case 'course-project':
      // Base cost is TBD, only extras are calculated
      if (document.querySelector('input[name="reportRequired"]:checked')?.value === 'yes') {
        costs.report = 700;
      }
      if (document.querySelector('input[name="pptRequired"]:checked')?.value === 'yes') {
        costs.ppt = 250;
      }
      // Total remains null (TBD) because base project cost is unknown
      break;

    case 'senior-project':
      // Base cost is TBD, only extras are calculated
      if (document.querySelector('input[name="reportRequired"]:checked')?.value === 'yes') {
        costs.report = 1200;
      }
      if (document.querySelector('input[name="pptRequired"]:checked')?.value === 'yes') {
        costs.ppt = 400;
      }
      // Total remains null (TBD) because base project cost is unknown
      break;

    case 'consulting':
      const hours = parseInt(document.getElementById('consultingHours')?.value) || 1;
      costs.consulting = hours * 80;
      total = costs.consulting; // Fixed rate, total is known
      break;

    case 'supervision':
      const supervisionMonths = parseInt(document.querySelector('input[name="supervisionPeriod"]:checked')?.value) || 1;
      costs.supervision = supervisionPrices[supervisionMonths] || 2500;
      total = costs.supervision; // Fixed rate, total is known
      break;

    case '3d-modeling':
      // Total is TBD - engineer needs to evaluate
      break;

    case '3d-printing':
      // Total is TBD - weight needs to be calculated
      break;

    case 'homework':
      // Total is TBD - engineer needs to evaluate
      break;
  }

  return { costs, total };
}

// Show confirmation modal
function showConfirmation(orderNumber, serviceType, details, costs, totalCost) {
  const modal = document.getElementById('confirmationModal');
  const orderNumberDisplay = document.getElementById('displayOrderNumber');
  const receiptSummary = document.getElementById('receiptSummary');
  const downloadBtn = document.getElementById('downloadPDF');

  orderNumberDisplay.textContent = orderNumber;

  // Build receipt summary
  let html = `<div class="receipt-item"><span>${currentLang === 'ar' ? 'نوع الخدمة' : 'Service'}</span><span>${getServiceName(serviceType)}</span></div>`;

  for (const [key, value] of Object.entries(costs)) {
    if (value) {
      const label = key === 'report' ? (currentLang === 'ar' ? 'تقرير' : 'Report') :
                    key === 'ppt' ? (currentLang === 'ar' ? 'عرض تقديمي' : 'Presentation') :
                    key === 'consulting' ? (currentLang === 'ar' ? 'استشارات' : 'Consulting') :
                    key === 'supervision' ? (currentLang === 'ar' ? 'متابعة' : 'Follow-up') : key;
      html += `<div class="receipt-item"><span>${label}</span><span>${value} SAR</span></div>`;
    }
  }

  // Show total
  if (totalCost) {
    html += `<div class="receipt-item" style="border-top: 1px solid var(--honey-gold); padding-top: 10px; margin-top: 10px;"><span><strong>${currentLang === 'ar' ? 'الإجمالي' : 'Total'}</strong></span><span><strong>${totalCost} SAR</strong></span></div>`;
  } else {
    html += `<div class="receipt-item" style="border-top: 1px solid var(--honey-gold); padding-top: 10px; margin-top: 10px;"><span><strong>${currentLang === 'ar' ? 'الإجمالي' : 'Total'}</strong></span><span style="color: var(--electric-blue);">${currentLang === 'ar' ? 'سيتم تحديده' : 'TBD'}</span></div>`;
  }

  receiptSummary.innerHTML = html;

  // Set invoice link (opens in new tab for printing)
  downloadBtn.href = `/api/orders/${orderNumber}/invoice?lang=${currentLang}`;
  downloadBtn.target = '_blank';
  downloadBtn.removeAttribute('download');

  modal.classList.add('active');
}

// Get service name
function getServiceName(serviceType) {
  const serviceNames = {
    'course-project': getTranslation('services.courseProject.title'),
    'senior-project': getTranslation('services.seniorProject.title'),
    'consulting': getTranslation('services.consulting.title'),
    'supervision': getTranslation('services.supervision.title'),
    '3d-modeling': getTranslation('services.modeling.title'),
    '3d-printing': getTranslation('services.printing.title'),
    'homework': getTranslation('services.homework.title')
  };
  return serviceNames[serviceType] || serviceType;
}

// Initialize modal
function initModal() {
  const modal = document.getElementById('confirmationModal');
  const newOrderBtn = document.getElementById('newOrderBtn');

  if (newOrderBtn) {
    newOrderBtn.addEventListener('click', () => {
      modal.classList.remove('active');
      document.getElementById('order').scrollIntoView({ behavior: 'smooth' });
    });
  }

  // Close modal on outside click
  modal?.addEventListener('click', (e) => {
    if (e.target === modal) {
      modal.classList.remove('active');
    }
  });
}

// Set current year in footer
function setCurrentYear() {
  const yearSpan = document.getElementById('currentYear');
  if (yearSpan) {
    yearSpan.textContent = new Date().getFullYear();
  }
}
