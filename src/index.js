require('dotenv').config();

const express = require('express');
const cors = require('cors');
const admin = require('firebase-admin');

// Initialize Firebase Admin SDK
let serviceAccount;

if (process.env.FIREBASE_SERVICE_ACCOUNT) {
  try {
    serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  } catch (error) {
    console.error('Error parsing FIREBASE_SERVICE_ACCOUNT env var:', error);
  }
} else {
  try {
    serviceAccount = require('../firebase-service-account.json');
  } catch (error) {
    console.warn('Could not load local firebase-service-account.json');
  }
}

if (serviceAccount) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
} else {
  console.error("Firebase Admin not initialized. Missing credentials.");
}

const app = express();

// Middleware — CORS locked to allowed origins only.
// Android app requests have no Origin header and pass through automatically.
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || 'http://localhost:3000')
  .split(',')
  .map((o) => o.trim());

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (mobile apps, curl, server-to-server)
      if (!origin) return callback(null, true);
      if (ALLOWED_ORIGINS.includes(origin)) return callback(null, true);
      callback(new Error(`CORS: origin '${origin}' is not allowed`));
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  })
);
app.use(express.json());

// Health check route
app.get('/', (req, res) => {
  res.json({ status: 'Wellness backend is running!' });
});

// Mount routes
app.use('/api/health', require('./routes/health'));
app.use('/api/sleep', require('./routes/sleep'));
app.use('/api/mood', require('./routes/mood'));
app.use('/api/journal', require('./routes/journal'));
app.use('/api/streaks', require('./routes/streaks'));
app.use('/api/user', require('./routes/user'));
app.use('/api/coach', require('./routes/coach'));
app.use('/api/workouts', require('./routes/workouts'));
app.use('/api/meditation', require('./routes/meditation'));
app.use('/api/timers', require('./routes/timers'));
app.use('/api/devices', require('./routes/devices'));

// Global error handler
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err.stack);
  res.status(500).json({ error: 'Internal server error' });
});

// Start server only if not in production (Vercel sets NODE_ENV to production)
if (process.env.NODE_ENV !== 'production') {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Wellness backend listening on port ${PORT}`);
  });
}

// Export for Vercel serverless function
module.exports = app;
