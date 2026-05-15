const express = require('express');
const router = express.Router();
const supabase = require('../db/supabase');
const auth = require('../middleware/auth');

/**
 * POST /sync
 * Syncs sleep entries from the Android app to Supabase.
 * Body: { entries: [ { date, totalMinutes, deepMinutes, lightMinutes, awakeMinutes, startTime, endTime, quality } ] }
 */
router.post('/sync', auth, async (req, res) => {
  try {
    const { entries } = req.body;

    if (!entries || !Array.isArray(entries) || entries.length === 0) {
      return res.status(400).json({ error: 'entries array is required and must not be empty' });
    }

    const rows = entries.map((e) => {
      // Calculate quality score if not provided or if we want to override
      // E.g., basic heuristic: deep sleep > 15% is good, total > 7 hours is good.
      let qualityScore = e.quality || 0;
      if (qualityScore === 0 && e.totalMinutes > 0) {
        let score = 50; // base score
        // add up to 20 points for total duration (7 hours = 420 mins is optimal)
        score += Math.min(20, (e.totalMinutes / 420) * 20);
        // add up to 30 points for deep sleep ratio (20% is optimal)
        const deepRatio = e.deepMinutes / e.totalMinutes;
        score += Math.min(30, (deepRatio / 0.20) * 30);
        qualityScore = Math.round(score);
      }

      return {
        user_id: req.userId,
        date: e.date,
        sleep_hours: e.totalMinutes ? e.totalMinutes / 60.0 : (e.sleepHours || 0),
        deep_minutes: e.deepMinutes || 0,
        light_minutes: e.lightMinutes || 0,
        awake_minutes: e.awakeMinutes || 0,
        start_time: e.startTime || null,
        end_time: e.endTime || null,
        quality_score: qualityScore
      };
    });

    const { data, error } = await supabase
      .from('sleep_entries')
      .upsert(rows, { onConflict: 'user_id,date' });

    if (error) {
      console.error('Supabase sleep sync error:', error);
      return res.status(500).json({ error: 'Failed to sync sleep entries' });
    }

    return res.json({ success: true, synced: rows.length });
  } catch (error) {
    console.error('Sleep sync error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /health-score
 * Computes a holistic daily health score based on sleep, activity, and HRV.
 */
router.get('/health-score', auth, async (req, res) => {
  try {
    const date = req.query.date || new Date().toISOString().split('T')[0];

    // 1. Get Sleep Quality
    const { data: sleepData } = await supabase
      .from('sleep_entries')
      .select('quality_score')
      .eq('user_id', req.userId)
      .eq('date', date)
      .eq('is_deleted', false)
      .single();

    const sleepScore = sleepData?.quality_score || 0;

    // 2. Get Daily Activity (Steps, Calories)
    const { data: activityData } = await supabase
      .from('daily_fitness_records')
      .select('steps')
      .eq('user_id', req.userId)
      .eq('date', date)
      .single();

    const steps = activityData?.steps || 0;
    const activityScore = Math.min(100, (steps / 8000) * 100); // 8000 steps = 100 points

    // 3. Compute Holistic Score
    // Weighting: 60% Sleep, 40% Activity
    const holisticScore = Math.round((sleepScore * 0.6) + (activityScore * 0.4));

    return res.json({ date, healthScore: holisticScore });
  } catch (error) {
    console.error('Health score error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /recent
 * Returns sleep entries for the last 7 days for the authenticated user.
 */
router.get('/recent', auth, async (req, res) => {
  try {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const { data, error } = await supabase
      .from('sleep_entries')
      .select('*')
      .eq('user_id', req.userId)
      .gte('date', sevenDaysAgo.toISOString().split('T')[0])
      .eq('is_deleted', false)
      .order('date', { ascending: false });

    if (error) {
      console.error('Supabase sleep recent error:', error);
      return res.status(500).json({ error: 'Failed to fetch recent sleep entries' });
    }

    return res.json(data);
  } catch (error) {
    console.error('Sleep recent error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;

/**
 * DELETE /:id
 * Deletes a sleep entry for the authenticated user.
 */
router.delete('/:id', auth, async (req, res) => {
  try {
    const { id } = req.params;
    
    if (!id) {
      return res.status(400).json({ error: 'id parameter is required' });
    }

    const { error } = await supabase
      .from('sleep_entries')
      .update({ is_deleted: true })
      .eq('id', id)
      .eq('user_id', req.userId);

    if (error) {
      console.error('Supabase sleep delete error:', error);
      return res.status(500).json({ error: 'Failed to delete sleep entry' });
    }

    return res.json({ success: true });
  } catch (error) {
    console.error('Sleep delete error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /monthly
 * Returns sleep entries for the last 30 days for the authenticated user.
 */
router.get('/monthly', auth, async (req, res) => {
  try {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const { data, error } = await supabase
      .from('sleep_entries')
      .select('*')
      .eq('user_id', req.userId)
      .gte('date', thirtyDaysAgo.toISOString().split('T')[0])
      .eq('is_deleted', false)
      .order('date', { ascending: false });

    if (error) {
      console.error('Supabase sleep monthly error:', error);
      return res.status(500).json({ error: 'Failed to fetch monthly sleep entries' });
    }

    return res.json(data);
  } catch (error) {
    console.error('Sleep monthly error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /yearly
 * Returns average sleep hours per month for the last 365 days.
 */
router.get('/yearly', auth, async (req, res) => {
  try {
    const oneYearAgo = new Date();
    oneYearAgo.setDate(oneYearAgo.getDate() - 365);

    const { data, error } = await supabase
      .from('sleep_entries')
      .select('sleep_hours, date')
      .eq('user_id', req.userId)
      .eq('is_deleted', false)
      .gte('date', oneYearAgo.toISOString().split('T')[0]);

    if (error) {
      console.error('Supabase sleep yearly error:', error);
      return res.status(500).json({ error: 'Failed to fetch yearly sleep entries' });
    }

    // Compute average sleep per month
    const monthlyAverages = {};
    data.forEach((entry) => {
      const monthYear = entry.date.substring(0, 7); // YYYY-MM
      if (!monthlyAverages[monthYear]) {
        monthlyAverages[monthYear] = { sum: 0, count: 0 };
      }
      monthlyAverages[monthYear].sum += entry.sleep_hours;
      monthlyAverages[monthYear].count += 1;
    });

    const aggregated = Object.keys(monthlyAverages).map(month => ({
      month,
      averageSleepHours: monthlyAverages[month].sum / monthlyAverages[month].count
    })).sort((a, b) => b.month.localeCompare(a.month));

    return res.json(aggregated);
  } catch (error) {
    console.error('Sleep yearly error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});
