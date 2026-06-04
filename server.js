const express = require('express');
const axios = require('axios');
const cron = require('node-cron');
const dotenv = require('dotenv');
const cors = require('cors');
const path = require('path');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// In-memory storage
let latestResponse = null;
let history = [];

// Helper: Send to Telegram
async function sendToTelegram(message) {
  const token = process.env.Telegram_TOKEN;
  const chatId = process.env.Telgeram_CHAT_ID;

  if (!token || !chatId) {
    console.error('Telegram credentials missing');
    return false;
  }

  try {
    const url = `https://api.telegram.org/bot${token}/sendMessage`;
    const response = await axios.post(url, {
      chat_id: chatId,
      text: message,
      parse_mode: 'HTML'
    });
    console.log('Telegram sent successfully');
    return true;
  } catch (error) {
    console.error('Telegram error:', error.message);
    return false;
  }
}

// Helper: Format response for display
function formatResponseForTelegram(data, statusCode, timestamp) {
  const timeStr = new Date(timestamp).toLocaleString('ar-EG', { timeZone: 'Africa/Cairo' });
  let bodyStr = '';

  if (data && typeof data === 'object') {
    bodyStr = JSON.stringify(data, null, 2);
    if (bodyStr.length > 3800) bodyStr = bodyStr.substring(0, 3800) + '...';
  } else {
    bodyStr = String(data);
  }

  return `
🔔 <b>تحديث جديد من نظام النتائج</b>
⏰ الوقت: ${timeStr}
📊 Status Code: ${statusCode}

📦 <b>البيانات:</b>
<pre>${bodyStr}</pre>
  `;
}

// Core function: Fetch API
async function fetchAndProcess() {
  const nationalId = process.env.National_ID;
  const mobilePhone = process.env.Mobile_Phone;
  const timestamp = Date.now();
  const dateTime = new Date(timestamp).toISOString();

  if (!nationalId || !mobilePhone) {
    const errorMsg = 'Missing National_ID or Mobile_Phone in .env';
    console.error(errorMsg);
    const errorRecord = {
      timestamp: dateTime,
      statusCode: 500,
      error: errorMsg,
      data: null
    };
    history.unshift(errorRecord);
    latestResponse = errorRecord;
    await sendToTelegram(`❌ خطأ في الإعدادات:\n${errorMsg}`);
    return;
  }

  const url = `https://www.gizaedu.net/api/results/ChatBot/RequestResult?MerchantRefNo=131313&GradeId=11&StageId=3&StudentKey=${nationalId}&MobileNo=${mobilePhone}&EducationId=null&SchoolId=null&isVisa=0`;

  try {
    console.log(`Fetching: ${url.replace(nationalId, '***').replace(mobilePhone, '***')}`);
    const response = await axios.get(url, {
      timeout: 30000,
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });

    const record = {
      timestamp: dateTime,
      statusCode: response.status,
      data: response.data,
      success: true
    };

    // Update storage
    latestResponse = record;
    history.unshift(record);
    if (history.length > 100) history.pop(); // Keep last 100 records

    console.log(`✅ Success - Status: ${response.status}`);

    // Send to Telegram
    const telegramMsg = formatResponseForTelegram(response.data, response.status, timestamp);
    await sendToTelegram(telegramMsg);

  } catch (error) {
    console.error(`❌ Fetch error:`, error.message);

    const errorRecord = {
      timestamp: dateTime,
      statusCode: error.response?.status || 500,
      error: error.message,
      data: error.response?.data || null,
      success: false
    };

    latestResponse = errorRecord;
    history.unshift(errorRecord);
    if (history.length > 100) history.pop();

    // Send error to Telegram
    const errorMsg = `
⚠️ <b>فشل جلب البيانات</b>
⏰ الوقت: ${new Date(timestamp).toLocaleString('ar-EG')}
📛 الخطأ: ${error.message}
${error.response ? `🔁 Status: ${error.response.status}` : ''}
    `;
    await sendToTelegram(errorMsg);
  }
}

// API Endpoints
app.get('/api/latest', (req, res) => {
  if (!latestResponse) {
    return res.json({ message: 'No data fetched yet', timestamp: new Date().toISOString() });
  }
  res.json(latestResponse);
});

app.get('/api/history', (req, res) => {
  res.json(history);
});

app.get('/api/health', (req, res) => {
  res.json({
    status: 'running',
    uptime: process.uptime(),
    lastCheck: latestResponse?.timestamp || null,
    historyCount: history.length
  });
});

// Serve dashboard for root route
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

// Cron Job: Every minute
if (process.env.NODE_ENV !== 'test') {
  cron.schedule('* * * * *', async () => {
    console.log('🕐 Cron job starting...', new Date().toISOString());
    await fetchAndProcess();
  });

  // Optional: Run immediately on start
  setTimeout(() => {
    console.log('🚀 Running initial fetch...');
    fetchAndProcess();
  }, 3000);
}

// Start server (only if not in Vercel serverless mode)
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
    console.log(`📊 Dashboard: http://localhost:${PORT}/`);
    console.log(`🔧 API: /api/latest | /api/history`);
  });
}

// Export for Vercel
module.exports = app;
