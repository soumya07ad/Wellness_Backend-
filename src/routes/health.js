const express = require('express');
const router = express.Router();
const supabase = require('../db/supabase');
const auth = require('../middleware/auth');

/**
 * POST /sync
 * Syncs health metrics from the Android app to Supabase.
 * Body: { metrics: [ { heartRate, spo2, systolic, diastolic, stress, steps, calories, distance, recordedAt } ] }
 */
router.post('/sync', auth, async (req, res) => {
  try {
    const { metrics } = req.body;

    if (!metrics || !Array.isArray(metrics) || metrics.length === 0) {
      return res.status(400).json({ error: 'metrics array is required and must not be empty' });
    }

    // Validate each metric entry
    for (let i = 0; i < metrics.length; i++) {
      const m = metrics[i];
      const numericFields = ['heartRate', 'spo2', 'systolic', 'diastolic', 'stress', 'steps', 'calories', 'distance', 'temperature', 'hrv', 'healthScore'];
      for (const field of numericFields) {
        if (m[field] !== undefined && m[field] !== null && typeof m[field] !== 'number') {
          return res.status(400).json({ error: `metrics[${i}].${field} must be a number` });
        }
      }
      if (!m.recordedAt || isNaN(Date.parse(m.recordedAt))) {
        return res.status(400).json({ error: `metrics[${i}].recordedAt must be a valid date string` });
      }
    }

    const rows = metrics.map((m) => ({
      user_id: req.userId,
      heart_rate: m.heartRate,
      spo2: m.spo2,
      systolic: m.systolic,
      diastolic: m.diastolic,
      stress: m.stress,
      steps: m.steps,
      calories: m.calories,
      distance: m.distance,
      temperature: m.temperature,
      hrv: m.hrv,
      health_score: m.healthScore,
      recorded_at: m.recordedAt,
    }));

    const { data, error } = await supabase
      .from('health_metrics')
      .upsert(rows, { onConflict: 'user_id,recorded_at' });

    if (error) {
      console.error('Supabase health sync error:', error);
      return res.status(500).json({ error: 'Failed to sync health metrics' });
    }

    return res.json({ success: true, synced: rows.length });
  } catch (error) {
    console.error('Health sync error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /recent
 * Returns health metrics for the authenticated user.
 */
router.get('/recent', auth, async (req, res) => {
  try {
    const { from, to } = req.query;

    let startDate;
    let endDate;

    if (from && !isNaN(Date.parse(from))) {
      startDate = new Date(from);
    } else {
      startDate = new Date();
      startDate.setDate(startDate.getDate() - 7);
    }

    if (to && !isNaN(Date.parse(to))) {
      endDate = new Date(to);
    }

    let query = supabase
      .from('health_metrics')
      .select('*')
      .eq('user_id', req.userId)
      .gte('recorded_at', startDate.toISOString())
      .order('recorded_at', { ascending: false });

    if (endDate) {
      query = query.lte('recorded_at', endDate.toISOString());
    }

    const { data, error } = await query;

    if (error) {
      console.error('Supabase health recent error:', error);
      return res.status(500).json({ error: 'Failed to fetch recent health metrics' });
    }

    return res.json(data);
  } catch (error) {
    console.error('Health recent error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /summary
 * Returns aggregated health stats for a single day.
 */
router.get('/summary', auth, async (req, res) => {
  try {
    const { date, timezoneOffset } = req.query;

    if (!date || isNaN(Date.parse(date))) {
      return res.status(400).json({ error: 'date query parameter is required (YYYY-MM-DD)' });
    }

    let dayStartISO, dayEndISO;

    if (timezoneOffset) {
      const offsetMinutes = parseInt(timezoneOffset, 10);
      if (isNaN(offsetMinutes)) {
        return res.status(400).json({ error: 'timezoneOffset must be a valid number of minutes' });
      }
      
      const baseDate = new Date(date + "T00:00:00Z");
      const localMidnight = new Date(baseDate.getTime() + (offsetMinutes * 60000));
      dayStartISO = localMidnight.toISOString();
      
      const localEndOfDay = new Date(localMidnight.getTime() + 86399999);
      dayEndISO = localEndOfDay.toISOString();
    } else {
      const dayStart = new Date(date);
      dayStart.setHours(0, 0, 0, 0);
      const dayEnd = new Date(date);
      dayEnd.setHours(23, 59, 59, 999);
      dayStartISO = dayStart.toISOString();
      dayEndISO = dayEnd.toISOString();
    }

    const { data, error } = await supabase
      .from('health_metrics')
      .select('*')
      .eq('user_id', req.userId)
      .gte('recorded_at', dayStartISO)
      .lte('recorded_at', dayEndISO);

    if (error) {
      console.error('Supabase health summary error:', error);
      return res.status(500).json({ error: 'Failed to fetch health summary' });
    }

    if (!data || data.length === 0) {
      return res.json({ date, recordCount: 0, summary: null });
    }

    const nums = (field) => data.map((d) => d[field]).filter((v) => v !== null && v !== undefined);
    const avg = (arr) => arr.length ? Math.round((arr.reduce((a, b) => a + b, 0) / arr.length) * 10) / 10 : null;
    const max = (arr) => arr.length ? Math.max(...arr) : null;
    const min = (arr) => arr.length ? Math.min(...arr) : null;
    const sum = (arr) => arr.length ? arr.reduce((a, b) => a + b, 0) : null;

    const summary = {
      heartRate: { avg: avg(nums('heart_rate')), max: max(nums('heart_rate')), min: min(nums('heart_rate')) },
      spo2: { avg: avg(nums('spo2')) },
      stress: { avg: avg(nums('stress')), max: max(nums('stress')) },
      steps: { total: sum(nums('steps')), max: max(nums('steps')) },
      calories: { total: sum(nums('calories')), max: max(nums('calories')) },
      distance: { total: sum(nums('distance')), max: max(nums('distance')) },
      temperature: { avg: avg(nums('temperature')) },
      hrv: { avg: avg(nums('hrv')) },
      healthScore: { avg: avg(nums('health_score')) },
    };

    return res.json({ date, recordCount: data.length, summary });
  } catch (error) {
    console.error('Health summary error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================================================
// NEW ENDPOINTS: INDIVIDUAL METRIC SYNC & DAILY SUMMARY (Fixing SyncWorker 404s)
// ============================================================================

/**
 * Helper to get ISO string for today if date is missing
 */
function getTargetDate(dateStr) {
  return dateStr ? new Date(dateStr).toISOString() : new Date().toISOString();
}

/**
 * POST /steps
 */
router.post('/steps', auth, async (req, res) => {
  try {
    const { steps, goal, progress, date } = req.body;
    
    // Insert into health_metrics to maintain historical data
    const { error } = await supabase
      .from('health_metrics')
      .insert({
        user_id: req.userId,
        steps: steps,
        recorded_at: getTargetDate(date)
      });
      
    if (error) throw error;
    
    return res.json({ success: true, data: req.body });
  } catch (error) {
    console.error('Steps log error:', error);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

router.get('/steps', auth, async (req, res) => {
  // Mock response for now to satisfy frontend contract if needed
  return res.json({ success: true, data: { steps: 0, goal: 10000, progress: 0, date: new Date().toISOString() } });
});

/**
 * POST /calories
 */
router.post('/calories', auth, async (req, res) => {
  try {
    const { calories, goal, progress, date } = req.body;
    
    const { error } = await supabase
      .from('health_metrics')
      .insert({
        user_id: req.userId,
        calories: calories,
        recorded_at: getTargetDate(date)
      });
      
    if (error) throw error;
    
    return res.json({ success: true, data: req.body });
  } catch (error) {
    console.error('Calories log error:', error);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

router.get('/calories', auth, async (req, res) => {
  return res.json({ success: true, data: { calories: 0, goal: 2000, progress: 0, date: new Date().toISOString() } });
});

/**
 * POST /heart-rate
 */
router.post('/heart-rate', auth, async (req, res) => {
  try {
    const { currentBPM, averageBPM, minBPM, maxBPM, timestamp } = req.body;
    
    const { error } = await supabase
      .from('health_metrics')
      .insert({
        user_id: req.userId,
        heart_rate: currentBPM,
        recorded_at: new Date(timestamp || Date.now()).toISOString()
      });
      
    if (error) throw error;
    
    return res.json({ success: true, data: req.body });
  } catch (error) {
    console.error('Heart rate log error:', error);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

router.get('/heart-rate', auth, async (req, res) => {
  return res.json({ success: true, data: { currentBPM: 0, averageBPM: 0, minBPM: 0, maxBPM: 0, timestamp: Date.now() } });
});

/**
 * POST /daily-summary
 * Saves the DailySummaryResponse object from the frontend (including waterIntake)
 */
router.post('/daily-summary', auth, async (req, res) => {
  try {
    const { date, steps, calories, avgHeartRate, activeTime, waterIntake, sleepDuration } = req.body;
    
    const targetDate = date || new Date().toISOString().split('T')[0];

    // We'll store this in daily_fitness_records (which we alter in the SQL to have water_intake)
    const { data, error } = await supabase
      .from('daily_fitness_records')
      .upsert({
        user_id: req.userId,
        date: targetDate,
        steps: steps || 0,
        calories_burned: calories || 0,
        active_minutes: activeTime || 0,
        water_intake: waterIntake || 0
      }, { onConflict: 'user_id,date' })
      .select()
      .single();

    if (error) {
       console.error('Supabase daily summary error:', error);
       return res.status(500).json({ success: false, error: 'Failed to save daily summary' });
    }

    return res.json({ success: true, data: req.body });
  } catch (error) {
    console.error('Daily summary save error:', error);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

/**
 * GET /daily-summary
 */
router.get('/daily-summary', auth, async (req, res) => {
  try {
    const date = req.query.date || new Date().toISOString().split('T')[0];
    
    const { data, error } = await supabase
      .from('daily_fitness_records')
      .select('*')
      .eq('user_id', req.userId)
      .eq('date', date)
      .single();

    if (error && error.code !== 'PGRST116') {
      return res.status(500).json({ success: false, error: 'Failed to fetch daily summary' });
    }

    if (!data) {
      return res.json({
        success: true,
        data: {
          date: date,
          steps: 0,
          calories: 0,
          avgHeartRate: 0,
          activeTime: 0,
          waterIntake: 0,
          sleepDuration: 0
        }
      });
    }

    return res.json({
      success: true,
      data: {
        date: data.date,
        steps: data.steps || 0,
        calories: data.calories_burned || 0,
        avgHeartRate: 0, // usually fetched from health_metrics avg
        activeTime: data.active_minutes || 0,
        waterIntake: data.water_intake || 0,
        sleepDuration: 0 // usually fetched from sleep_entries
      }
    });
  } catch (error) {
    console.error('Daily summary get error:', error);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

module.exports = router;
